'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const {
  DEFAULT_OPTIONS,
  calculateDimmingPlan,
  calculateReliefProof,
  calculateTariffReduction,
} = require('../src/flex-calculator');

const NS_DEVICES = 'flex_devices';
const NS_EVENTS = 'flex_events';
const NS_PLANS = 'flex_plans';

const CONSTRAINTS = {
  minPowerKw: DEFAULT_OPTIONS.minPowerKw,
  maxDurationMinutes: DEFAULT_OPTIONS.maxDurationMinutes,
  cooldownMinutes: DEFAULT_OPTIONS.cooldownMinutes,
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function parsePeriod(period) {
  const value = String(period || '').trim();

  const monthMatch = value.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]) - 1;
    return {
      from: new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString(),
      to: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0)).toISOString(),
    };
  }

  const quarterMatch = value.match(/^(\d{4})-Q([1-4])$/i);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const month = (quarter - 1) * 3;
    return {
      from: new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString(),
      to: new Date(Date.UTC(year, month + 3, 1, 0, 0, 0)).toISOString(),
    };
  }

  throw new MoleculerClientError(
    'Invalid period format. Use YYYY-MM or YYYY-QN.',
    422,
    'INVALID_PERIOD'
  );
}

function isServiceNotFound(error) {
  return error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError';
}

module.exports = {
  name: 'flex',
  timeout: 120000,
  dependencies: ['edm'],

  settings: {
    defaultThreshold: DEFAULT_OPTIONS.threshold,
    minPowerKw: CONSTRAINTS.minPowerKw,
    maxDimmingMinutes: CONSTRAINTS.maxDurationMinutes,
    cooldownMinutes: CONSTRAINTS.cooldownMinutes,
  },

  actions: {
    registerDevice: {
      rest: 'POST /devices',
      params: {
        deviceId: { type: 'string', pattern: /^[a-z0-9_]+$/, max: 64 },
        type: {
          type: 'enum',
          values: ['wallbox', 'heat_pump', 'storage', 'air_conditioning', 'other'],
        },
        capacityKw: { type: 'number', positive: true, convert: true },
        minDimmingKw: { type: 'number', optional: true, default: 4.2, convert: true },
        meloId: { type: 'string', optional: true },
        customerName: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        steuerboxId: { type: 'string', optional: true },
        registeredSince: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Register a controllable device (§14a EnWG)',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        description:
          'Registers a controllable consumption device (wallbox, heat pump, storage) for §14a grid management. Devices are eligible for reduced network tariffs in exchange for temporary dimming.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId', 'type', 'capacityKw'],
                properties: {
                  deviceId: { type: 'string', example: 'wb_test_001' },
                  type: {
                    type: 'string',
                    enum: ['wallbox', 'heat_pump', 'storage', 'air_conditioning', 'other'],
                    example: 'wallbox',
                  },
                  capacityKw: { type: 'number', example: 11 },
                  minDimmingKw: { type: 'number', example: 4.2 },
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  customerName: { type: 'string', example: 'Max Mustermann' },
                  postalCode: { type: 'string', example: '66989' },
                  steuerboxId: { type: 'string', example: 'STB-001' },
                  registeredSince: { type: 'string', example: '2026-04-26T10:00:00.000Z' },
                },
              },
              examples: {
                default: {
                  value: {
                    deviceId: 'wb_test_001',
                    type: 'wallbox',
                    capacityKw: 11,
                    minDimmingKw: 4.2,
                    customerName: 'Max Mustermann',
                    postalCode: '66989',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { deviceId } = ctx.params;
        const existing = await this.getObject(ctx, NS_DEVICES, deviceId, false);
        if (existing) {
          throw new MoleculerClientError('Device already registered', 409, 'FLEX_DEVICE_EXISTS');
        }

        const payload = {
          deviceId,
          type: ctx.params.type,
          capacityKw: toNumber(ctx.params.capacityKw, 0),
          minDimmingKw: toNumber(ctx.params.minDimmingKw, this.settings.minPowerKw),
          meloId: ctx.params.meloId || null,
          customerName: ctx.params.customerName || null,
          postalCode: ctx.params.postalCode || null,
          steuerboxId: ctx.params.steuerboxId || null,
          registeredSince: ctx.params.registeredSince || nowIso(),
          status: 'active',
          section14aStatus: 'registered',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        await ctx.call('object-store.put', {
          namespace: NS_DEVICES,
          key: deviceId,
          payload,
        });

        return {
          success: true,
          deviceId,
          type: payload.type,
          section14aStatus: 'registered',
        };
      },
    },

    listDevices: {
      rest: 'GET /devices',
      params: {
        type: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List registered §14a devices',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        parameters: [
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'wallbox' },
          },
          {
            name: 'postalCode',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '66989' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'active' },
          },
        ],
      },
      async handler(ctx) {
        const docs = await this.listNamespace(ctx, NS_DEVICES);

        const data = docs.filter((doc) => {
          const payload = doc.payload || {};
          if (ctx.params.type && payload.type !== ctx.params.type) return false;
          if (ctx.params.postalCode && payload.postalCode !== ctx.params.postalCode) return false;
          if (ctx.params.status && payload.status !== ctx.params.status) return false;
          return true;
        });

        return {
          success: true,
          count: data.length,
          data,
        };
      },
    },

    getDevice: {
      rest: 'GET /devices/:deviceId',
      params: {
        deviceId: { type: 'string' },
      },
      openapi: {
        summary: 'Get registered §14a device',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'wb_test_001' },
          },
        ],
      },
      async handler(ctx) {
        const device = await this.getObject(ctx, NS_DEVICES, ctx.params.deviceId, true);
        return {
          success: true,
          key: ctx.params.deviceId,
          payload: device,
        };
      },
    },

    updateDeviceStatus: {
      rest: 'PUT /devices/:deviceId/status',
      params: {
        deviceId: { type: 'string' },
        status: {
          type: 'enum',
          values: ['active', 'inactive', 'maintenance', 'deregistered'],
        },
      },
      openapi: {
        summary: 'Update §14a device status',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'wb_test_001' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['active', 'inactive', 'maintenance', 'deregistered'],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const payload = await this.getObject(ctx, NS_DEVICES, ctx.params.deviceId, true);
        const updatedPayload = {
          ...payload,
          status: ctx.params.status,
          updatedAt: nowIso(),
        };

        await ctx.call('object-store.put', {
          namespace: NS_DEVICES,
          key: ctx.params.deviceId,
          payload: updatedPayload,
        });

        return {
          success: true,
          deviceId: ctx.params.deviceId,
          status: ctx.params.status,
        };
      },
    },

    planDimming: {
      rest: 'POST /events/plan',
      params: {
        date: { type: 'string' },
        gridCapacityKw: { type: 'number', convert: true, positive: true },
        postalCode: { type: 'string', optional: true },
        threshold: { type: 'number', optional: true, default: DEFAULT_OPTIONS.threshold, convert: true },
        loadForecastOverride: { type: 'array', optional: true, items: { type: 'object' } },
      },
      openapi: {
        summary: 'Plan dimming events based on load forecast',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        description:
          'Analyzes load forecast against grid capacity and generates a dimming plan. Respects §14a constraints: min 4.2 kW, max 2h duration, min 2h cooldown between events.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date', 'gridCapacityKw'],
                properties: {
                  date: { type: 'string', example: '2026-04-20' },
                  gridCapacityKw: { type: 'number', example: 100 },
                  postalCode: { type: 'string', example: '66989' },
                  threshold: { type: 'number', example: 0.85 },
                  loadForecastOverride: {
                    type: 'array',
                    example: [
                      { ts: '2026-04-20T18:00:00.000Z', value: 95 },
                      { ts: '2026-04-20T18:15:00.000Z', value: 92 },
                    ],
                    items: {
                      type: 'object',
                      properties: {
                        ts: { type: 'string' },
                        value: { type: 'number' },
                      },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    date: '2026-04-20',
                    gridCapacityKw: 100,
                    threshold: 0.85,
                    postalCode: '66989',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const devicesResponse = await ctx.call('flex.listDevices', {
          status: 'active',
          postalCode: ctx.params.postalCode,
        });

        const devices = Array.isArray(devicesResponse?.data)
          ? devicesResponse.data.map((doc) => doc.payload || doc)
          : [];

        const loadForecast = Array.isArray(ctx.params.loadForecastOverride)
          ? ctx.params.loadForecastOverride
          : await this.loadForecast(ctx, ctx.params);

        const options = {
          threshold: toNumber(ctx.params.threshold, this.settings.defaultThreshold),
          minPowerKw: this.settings.minPowerKw,
          maxDurationMinutes: this.settings.maxDimmingMinutes,
          cooldownMinutes: this.settings.cooldownMinutes,
          priorityOrder: DEFAULT_OPTIONS.priorityOrder,
        };

        const plan = calculateDimmingPlan(devices, loadForecast, ctx.params.gridCapacityKw, options);
        const planId = createId('flexplan');

        await ctx.call('object-store.put', {
          namespace: NS_PLANS,
          key: planId,
          payload: {
            planId,
            date: ctx.params.date,
            gridCapacityKw: ctx.params.gridCapacityKw,
            postalCode: ctx.params.postalCode || null,
            options,
            events: plan.events,
            summary: plan.summary,
            createdAt: nowIso(),
            status: 'planned',
          },
        });

        return {
          success: true,
          planId,
          events: plan.events,
          summary: plan.summary,
        };
      },
    },

    executeDimming: {
      rest: 'POST /events/execute',
      params: {
        planId: { type: 'string', optional: true },
        deviceId: { type: 'string', optional: true },
        durationMinutes: { type: 'number', optional: true, default: 30, convert: true },
        dimmedPowerKw: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Execute dimming event (real or simulated)',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        description:
          'Executes a dimming plan or single device dimming. Publishes MQTT command to cernion/flex/{deviceId}/dimming topic and stores events for Entlastungsnachweis.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  planId: { type: 'string', example: 'flexplan_1714123456789_ab12cd34' },
                  deviceId: { type: 'string', example: 'wb_test_001' },
                  durationMinutes: { type: 'number', example: 30 },
                  dimmedPowerKw: { type: 'number', example: 4.2 },
                },
              },
              examples: {
                byPlan: {
                  value: {
                    planId: 'flexplan_1714123456789_ab12cd34',
                  },
                },
                singleDevice: {
                  value: {
                    deviceId: 'wb_test_001',
                    durationMinutes: 30,
                    dimmedPowerKw: 4.2,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const events = await this.resolveEventsToExecute(ctx);
        let mqttPublished = 0;
        const executionErrors = [];

        for (const event of events) {
          try {
            await ctx.call('mqtt-broker.publish', {
              topic: `cernion/flex/${event.deviceId}/dimming`,
              payload: {
                action: 'dim',
                targetPowerKw: event.dimmedPowerKw,
                durationMinutes: event.durationMinutes,
                reason: event.reason,
              },
              qos: 2,
            });
            mqttPublished += 1;
          } catch (error) {
            if (!isServiceNotFound(error)) {
              throw error;
            }
            executionErrors.push({
              deviceId: event.deviceId,
              type: 'MQTT_SERVICE_UNAVAILABLE',
              message: 'mqtt-broker service not available, execution simulated.',
            });
          }

          await ctx.call('object-store.put', {
            namespace: NS_EVENTS,
            key: createId('flexevt'),
            payload: {
              ...event,
              executedAt: nowIso(),
              mqttPublished: !executionErrors.find((entry) => entry.deviceId === event.deviceId),
            },
          });
        }

        return {
          success: true,
          executedEvents: events.length,
          mqttPublished,
          warnings: executionErrors,
        };
      },
    },

    getReliefProof: {
      rest: 'GET /relief-proof/:period',
      params: {
        period: { type: 'string' },
        postalCode: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Generate Entlastungsnachweis for a period',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        description:
          'Documents effectiveness of §14a dimming measures with event-level and aggregated relief indicators.',
        parameters: [
          {
            name: 'period',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '2026-04' },
          },
          {
            name: 'postalCode',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '66989' },
          },
        ],
      },
      async handler(ctx) {
        const { from, to } = parsePeriod(ctx.params.period);
        const allEvents = await this.listNamespace(ctx, NS_EVENTS);
        const devices = await this.listNamespace(ctx, NS_DEVICES);
        const deviceById = new Map(devices.map((doc) => [doc.key, doc.payload || {}]));

        const events = allEvents
          .map((doc) => doc.payload || {})
          .filter((event) => {
            const start = new Date(event.start || event.executedAt || 0).toISOString();
            if (start < from || start >= to) return false;
            if (!ctx.params.postalCode) return true;
            const device = deviceById.get(event.deviceId) || {};
            return device.postalCode === ctx.params.postalCode;
          });

        const loadBefore = [];
        const loadAfter = [];

        for (const event of events) {
          if (!event.meloId || !event.start || !event.end) {
            continue;
          }
          try {
            const beforeSeries = await ctx.call('edm.getTimeseries', {
              meloId: event.meloId,
              obis: '1-0:1.29.0',
              from: event.start,
              to: event.end,
              resolution: '15min',
              format: 'json',
            });
            const values = Array.isArray(beforeSeries?.values) ? beforeSeries.values : [];
            for (const row of values) {
              const current = toNumber(row?.value, 0);
              loadBefore.push({ ts: row.ts, value: current });
              loadAfter.push({ ts: row.ts, value: Math.max(0, current - toNumber(event.reductionKw, 0)) });
            }
          } catch (_error) {
            // KRITIS fallback: proof can still be generated from event payloads.
          }
        }

        const proof = calculateReliefProof(events, loadBefore, loadAfter);

        return {
          success: true,
          period: ctx.params.period,
          proof,
        };
      },
    },

    getTariffReduction: {
      rest: 'GET /customer/:deviceId/reduction',
      params: {
        deviceId: { type: 'string' },
        annualHours: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Calculate §14a tariff reduction for a customer',
        tags: ['Flex (§14a Flexibilitätsmanagement)'],
        description:
          'Calculates annual and monthly network tariff reduction for participating §14a SVE customers.',
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'wb_test_001' },
          },
          {
            name: 'annualHours',
            in: 'query',
            required: false,
            schema: { type: 'number', example: 8760 },
          },
        ],
      },
      async handler(ctx) {
        const device = await this.getObject(ctx, NS_DEVICES, ctx.params.deviceId, true);
        const reduction = calculateTariffReduction(device, ctx.params.annualHours);

        return {
          success: true,
          deviceId: ctx.params.deviceId,
          reduction,
        };
      },
    },
  },

  methods: {
    async getObject(ctx, namespace, key, throwIfMissing = true) {
      try {
        const result = await ctx.call('object-store.get', { namespace, key });
        return result?.payload || result?.value || result?.data || null;
      } catch (error) {
        if (error?.code === 404 || error?.type === 'OBJECT_NOT_FOUND') {
          if (!throwIfMissing) return null;
          throw new MoleculerClientError('Object not found', 404, 'OBJECT_NOT_FOUND');
        }
        throw error;
      }
    },

    async listNamespace(ctx, namespace) {
      try {
        const result = await ctx.call('object-store.list', { namespace });
        if (Array.isArray(result?.data)) return result.data;
        if (Array.isArray(result)) return result;
      } catch (_error) {
        // Fallback to object-store.query for current implementation.
      }

      const result = await ctx.call('object-store.query', {
        namespace,
        selector: {},
        limit: 5000,
        skip: 0,
      });

      return (Array.isArray(result?.docs) ? result.docs : []).map((doc) => ({
        key: doc.key,
        payload: doc.payload,
      }));
    },

    async loadForecast(ctx, params) {
      const response = await ctx.call('forecast-engine.forecastLoad', {
        date: params.date,
        postleitzahl: params.postalCode,
      });

      const values = Array.isArray(response?.forecast?.values)
        ? response.forecast.values
        : Array.isArray(response?.forecast?.intervals)
          ? response.forecast.intervals
          : Array.isArray(response?.values)
            ? response.values
            : [];

      return values.map((row) => ({
        ts: row.ts,
        value: toNumber(row.value, 0) * 4,
      }));
    },

    async resolveEventsToExecute(ctx) {
      if (ctx.params.planId) {
        const plan = await this.getObject(ctx, NS_PLANS, ctx.params.planId, true);
        const events = Array.isArray(plan?.events) ? plan.events : [];
        if (events.length === 0) {
          throw new MoleculerClientError('No events in plan', 422, 'FLEX_PLAN_EMPTY');
        }
        return events;
      }

      if (!ctx.params.deviceId) {
        throw new MoleculerClientError(
          'Either planId or deviceId must be provided.',
          422,
          'INVALID_FLEX_EXECUTION_REQUEST'
        );
      }

      const device = await this.getObject(ctx, NS_DEVICES, ctx.params.deviceId, true);
      const durationMinutes = Math.max(1, toNumber(ctx.params.durationMinutes, 30));
      const dimmedPowerKw = toNumber(
        ctx.params.dimmedPowerKw,
        Math.max(this.settings.minPowerKw, toNumber(device.minDimmingKw, this.settings.minPowerKw))
      );
      const cappedDimmedPowerKw = Math.max(this.settings.minPowerKw, dimmedPowerKw);

      return [
        {
          deviceId: device.deviceId || ctx.params.deviceId,
          deviceType: device.type,
          meloId: device.meloId || null,
          start: nowIso(),
          end: new Date(Date.now() + durationMinutes * 60000).toISOString(),
          durationMinutes,
          originalPowerKw: toNumber(device.capacityKw, 0),
          dimmedPowerKw: cappedDimmedPowerKw,
          reductionKw: Math.max(0, toNumber(device.capacityKw, 0) - cappedDimmedPowerKw),
          reason: 'grid_congestion',
        },
      ];
    },
  },
};
