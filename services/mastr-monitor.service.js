'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { startJob } = require('../src/job-store');
const { computeDelta, buildSnapshotEntry } = require('../src/mastr-monitor-diff');
const { isDue } = require('../src/mastr-monitor-scheduler');
const { isSmtpConfigured, sendDeltaNotification, sendConfirmationEmail } = require('../src/mastr-monitor-notify');

const WATCHES_NAMESPACE = 'mastr_watches';
const SNAPSHOTS_NAMESPACE = 'mastr_snapshots';
const SNAPSHOT_CHUNKS_NAMESPACE = 'mastr_snapshot_chunks';
const DELTAS_NAMESPACE = 'mastr_deltas';
const DELTA_CHUNKS_NAMESPACE = 'mastr_delta_chunks';
const SUBSCRIPTIONS_NAMESPACE = 'mastr_subscriptions';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function shortUuid(length = 8) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function toIsoNow() {
  return new Date().toISOString();
}

function pickLatestByTimestamp(items, field = 'createdAt') {
  if (!Array.isArray(items) || items.length === 0) return null;
  return [...items].sort((a, b) => {
    const left = String(a?.[field] || '');
    const right = String(b?.[field] || '');
    return right.localeCompare(left);
  })[0];
}

function formatCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';

  const headers = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const esc = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => esc(row?.[header])).join(','));
  }
  return lines.join('\n');
}

function isSingleNumericCronField(field) {
  return /^\d+$/.test(String(field || '').trim());
}

function isAtMostDailyCron(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour] = parts;

  // Minimum interval policy: daily or less frequent.
  // This requires exactly one time-of-day trigger (single minute + single hour).
  return isSingleNumericCronField(minute) && isSingleNumericCronField(hour);
}

function readIntEnv(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  name: 'mastr-monitor',
  timeout: 120000,

  settings: {
    defaultWatchFields: [
      'einheitBetriebsstatus', 'nettonennleistung', 'bruttoleistung',
      'inbetriebnahmedatum', 'fernsteuerbarkeitDv',
      'netzbetreiberpruefungStatus', 'direktvermarkterMastrNummer',
      'direktvermarkterName', 'napData.spannungsebene', 'lastUpdatedAt',
    ],
    maxInstallationsPerWatch: readIntEnv('MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH', 50000),
    chunkingEnabled: String(process.env.MASTR_MONITOR_CHUNKING_ENABLED || 'true').toLowerCase() !== 'false',
    chunkSize: readIntEnv('MASTR_MONITOR_CHUNK_SIZE', 1000),
    snapshotRetention: 30,
    deltaRetentionDays: 90,
    defaultSchedule: { type: 'preset', preset: 'weekday_morning' },
    schedulePresets: {
      daily_morning: '0 6 * * *',
      weekday_morning: '0 6 * * 1-5',
      weekly_monday: '0 6 * * 1',
      monthly_first: '0 6 1 * *',
    },
  },

  started() {
    if (!isSmtpConfigured()) {
      this.logger.warn('[mastr-monitor] SMTP not configured — email notifications are disabled.');
    }
    this._schedulerInterval = setInterval(() => this.checkScheduledWatches(), 60_000);
  },

  stopped() {
    if (this._schedulerInterval) {
      clearInterval(this._schedulerInterval);
      this._schedulerInterval = null;
    }
  },

  events: {
    'mastr.data.refreshed'(payload) {
      this.checkScheduledWatches().catch((err) =>
        this.logger.error('[mastr-monitor] checkScheduledWatches error:', err.message)
      );
    },
  },

  actions: {
    createWatch: {
      rest: 'POST /watches',
      openapi: {
        summary: 'Create MaStR monitor watch',
        tags: ['MaStR Monitor'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'query'],
              },
              examples: {
                default: {
                  value: {
                    name: 'TWL Solar >100kW Monitoring',
                    query: { gridOperatorMastrId: 'SNB935578300972', type: 'solar', minCapacity: 100 },
                  },
                },
              },
            },
          },
        },
      },
      params: {
        name: { type: 'string', min: 3, max: 200 },
        query: { type: 'object', props: {
          gridOperatorMastrId: { type: 'string', optional: true },
          gridOperatorBdewCode: { type: 'string', optional: true },
          type: { type: 'enum', values: ['solar', 'wind', 'storage', 'biomass', 'all'], optional: true, default: 'all' },
          minCapacity: { type: 'number', optional: true },
          maxCapacity: { type: 'number', optional: true },
          status: { type: 'string', optional: true },
          postleitzahl: { type: 'string', optional: true },
          gemeinde: { type: 'string', optional: true },
          landkreis: { type: 'string', optional: true },
          bundesland: { type: 'string', optional: true },
          fernsteuerbarkeitDv: { type: 'boolean', optional: true },
          netzbetreiberPruefungStatus: { type: 'string', optional: true },
        } },
        watchFields: { type: 'array', items: 'string', optional: true },
        schedule: { type: 'object', optional: true, props: {
          type: { type: 'enum', values: ['cron', 'preset'] },
          expression: { type: 'string', optional: true },
          preset: { type: 'enum', values: ['daily_morning', 'weekday_morning', 'weekly_monday', 'monthly_first'], optional: true },
          timezone: { type: 'string', optional: true, default: 'Europe/Berlin' },
        } },
        notifications: { type: 'array', optional: true, items: {
          type: 'object', props: {
            channel: { type: 'enum', values: ['email'] },
            to: { type: 'email' },
            onlyOnChanges: { type: 'boolean', optional: true, default: true },
            language: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
          },
        } },
      },
      async handler(ctx) {
        const createdAt = toIsoNow();
        const watchId = `${slugify(ctx.params.name)}_${shortUuid(8)}`;
        const watchFields = Array.isArray(ctx.params.watchFields) && ctx.params.watchFields.length > 0
          ? [...new Set(ctx.params.watchFields)]
          : [...this.settings.defaultWatchFields];

        const schedule = this.resolveSchedule(ctx.params.schedule);
        const watchToken = crypto.randomBytes(24).toString('hex');

        const watch = {
          watchId,
          name: ctx.params.name,
          query: ctx.params.query || {},
          watchFields,
          schedule,
          notifications: Array.isArray(ctx.params.notifications) ? ctx.params.notifications : [],
          tokenHash: hashToken(watchToken),
          status: 'pending_baseline',
          lastRun: null,
          nextRun: null,
          installationCount: 0,
          createdAt,
          updatedAt: createdAt,
        };

        await this.putObject(WATCHES_NAMESPACE, watchId, watch);

        const subscriptions = [];
        for (const n of watch.notifications) {
          if (n.channel !== 'email') continue;
          const token = crypto.randomBytes(24).toString('hex');
          const sub = {
            watchId,
            email: n.to,
            channel: 'email',
            onlyOnChanges: n.onlyOnChanges !== false,
            language: n.language || 'de',
            status: 'pending_confirmation',
            tokenHash: hashToken(token),
            createdAt,
            updatedAt: createdAt,
          };
          await this.putObject(SUBSCRIPTIONS_NAMESPACE, `${watchId}:${sub.tokenHash}`, sub);
          subscriptions.push({ email: sub.email, status: sub.status });
        }

        await this.startBaselineSnapshotJob(watchId);

        return {
          success: true,
          watchId,
          name: ctx.params.name,
          tokenUrl: this.buildWatchTokenUrl(watchToken),
          status: 'pending_baseline',
          message: 'Watch erstellt. Erste Baseline wird jetzt erfasst.',
          subscriptions,
        };
      },
    },

    listWatches: {
      rest: 'GET /watches',
      openapi: {
        summary: 'List MaStR monitor watches',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'email', in: 'query', required: false, schema: { type: 'string', format: 'email', example: 'netzplanung@twl.de' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'number', default: 50, example: 50 } },
        ],
      },
      params: {
        email: { type: 'email', optional: true },
        limit: { type: 'number', optional: true, convert: true },
      },
      async handler(ctx) {
        let watches = await this.listPayloads(WATCHES_NAMESPACE);

        if (ctx.params.email) {
          const subs = await this.queryObjects(SUBSCRIPTIONS_NAMESPACE, {
            'payload.email': ctx.params.email,
          });
          const watchIds = new Set(subs.map((d) => d?.payload?.watchId).filter(Boolean));
          watches = watches.filter((watch) => watchIds.has(watch.watchId));
        }

        const limit = Number(ctx.params.limit || 0);
        const sliced = limit > 0 ? watches.slice(0, limit) : watches;

        return {
          watches: sliced,
          total: sliced.length,
        };
      },
    },

    getWatch: {
      rest: 'GET /watches/:watchId',
      openapi: {
        summary: 'Get MaStR monitor watch',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'watchId', in: 'path', required: true, schema: { type: 'string', example: 'twl-solar-monitor_ab12cd34' } },
        ],
      },
      params: {
        watchId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const watch = await this.getPayload(WATCHES_NAMESPACE, ctx.params.watchId);
        if (!watch) {
          throw new MoleculerClientError('Watch not found', 404, 'WATCH_NOT_FOUND');
        }

        const deltas = await this.listByPrefix(DELTAS_NAMESPACE, `${ctx.params.watchId}:`);
        const latestDelta = pickLatestByTimestamp(deltas, 'timestamp');

        return {
          ...watch,
          lastDelta: latestDelta
            ? {
                added: latestDelta?.summary?.added || 0,
                removed: latestDelta?.summary?.removed || 0,
                changed: latestDelta?.summary?.changed || 0,
                timestamp: latestDelta.timestamp || null,
              }
            : null,
        };
      },
    },

    deleteWatch: {
      rest: 'DELETE /watches/:watchId',
      openapi: {
        summary: 'Delete MaStR monitor watch and all linked objects',
        tags: ['MaStR Monitor'],
      },
      params: {
        watchId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const watch = await this.getPayload(WATCHES_NAMESPACE, ctx.params.watchId);
        if (!watch) {
          throw new MoleculerClientError('Watch not found', 404, 'WATCH_NOT_FOUND');
        }

        await this.broker.call('object-store.delete', {
          namespace: WATCHES_NAMESPACE,
          key: ctx.params.watchId,
        });

        await this.deleteByPrefix(SNAPSHOTS_NAMESPACE, `${ctx.params.watchId}:`);
        await this.deleteByPrefix(SNAPSHOT_CHUNKS_NAMESPACE, `${ctx.params.watchId}:`);
        await this.deleteByPrefix(DELTAS_NAMESPACE, `${ctx.params.watchId}:`);
        await this.deleteByPrefix(DELTA_CHUNKS_NAMESPACE, `${ctx.params.watchId}:`);
        await this.deleteByPrefix(SUBSCRIPTIONS_NAMESPACE, `${ctx.params.watchId}:`);

        return { success: true, watchId: ctx.params.watchId };
      },
    },

    runWatch: {
      rest: 'POST /watches/:watchId/run',
      openapi: {
        summary: 'Run watch now',
        tags: ['MaStR Monitor'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['watchId'],
                properties: {
                  watchId: { type: 'string', example: 'twl-solar-monitor_ab12cd34', nullable: true },
                },
              },
              examples: {
                default: {
                  value: {},
                },
              },
            },
          },
        },
      },
      params: {
        watchId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const { watchId } = ctx.params;
        const result = await this.executeWatch(watchId, ctx.meta || {});
        return { success: true, ...result };
      },
    },

    getDeltas: {
      rest: 'GET /watches/:watchId/deltas',
      openapi: {
        summary: 'Get delta history for watch',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'watchId', in: 'path', required: true, schema: { type: 'string', example: 'twl-solar-monitor_ab12cd34' } },
        ],
      },
      params: {
        watchId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const docs = await this.listDocsByPrefix(DELTAS_NAMESPACE, `${ctx.params.watchId}:`);
        const sortedDocs = docs.sort((a, b) => String(b.key || '').localeCompare(String(a.key || '')));

        const deltas = [];
        for (const doc of sortedDocs) {
          const hydrated = await this.hydrateDeltaPayload(doc.payload || null);
          if (hydrated) deltas.push(hydrated);
        }

        return {
          watchId: ctx.params.watchId,
          deltas,
        };
      },
    },

    getDelta: {
      rest: 'GET /watches/:watchId/deltas/:deltaId',
      openapi: {
        summary: 'Get one delta by ID',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'watchId', in: 'path', required: true, schema: { type: 'string', example: 'twl-solar-monitor_ab12cd34' } },
          { name: 'deltaId', in: 'path', required: true, schema: { type: 'string', example: '2026-04-16' } },
        ],
      },
      params: {
        watchId: { type: 'string', min: 1 },
        deltaId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const key = `${ctx.params.watchId}:${ctx.params.deltaId}`;
        const delta = await this.getPayload(DELTAS_NAMESPACE, key);
        if (!delta) {
          throw new MoleculerClientError('Delta not found', 404, 'DELTA_NOT_FOUND');
        }
        return this.hydrateDeltaPayload(delta);
      },
    },

    getSnapshot: {
      rest: 'GET /watches/:watchId/snapshot',
      openapi: {
        summary: 'Get latest snapshot in JSON or CSV',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'watchId', in: 'path', required: true, schema: { type: 'string', example: 'twl-solar-monitor_ab12cd34' } },
          { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'csv'], default: 'json', example: 'json' } },
        ],
      },
      params: {
        watchId: { type: 'string', min: 1 },
        format: { type: 'enum', values: ['json', 'csv'], optional: true, default: 'json' },
      },
      async handler(ctx) {
        const snapshotDocs = await this.listDocsByPrefix(SNAPSHOTS_NAMESPACE, `${ctx.params.watchId}:`);
        const latestDoc = snapshotDocs
          .sort((a, b) => String(b.key || '').localeCompare(String(a.key || '')))[0] || null;
        const latest = await this.hydrateSnapshotPayload(latestDoc?.payload || null);
        if (!latest) {
          throw new MoleculerClientError('Snapshot not found', 404, 'SNAPSHOT_NOT_FOUND');
        }

        if (ctx.params.format === 'csv') {
          const rows = Array.isArray(latest.installations)
            ? latest.installations
            : Array.isArray(latest.entries)
              ? latest.entries
              : [];
          ctx.meta.$responseType = 'text/csv; charset=utf-8';
          ctx.meta.$responseHeaders = {
            ...(ctx.meta.$responseHeaders || {}),
            'Content-Disposition': `attachment; filename="${ctx.params.watchId}-snapshot.csv"`,
          };
          return formatCsv(rows);
        }

        return latest;
      },
    },

    subscribe: {
      rest: 'POST /watches/:watchId/subscribe',
      openapi: {
        summary: 'Create subscription for watch',
        tags: ['MaStR Monitor'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['watchId', 'email'],
                properties: {
                  watchId: { type: 'string', example: 'twl-solar-monitor_ab12cd34', nullable: true },
                  email: { type: 'string', format: 'email', example: 'netzplanung@twl.de' },
                  onlyOnChanges: { type: 'boolean', default: true },
                  language: { type: 'string', enum: ['de', 'en'], default: 'de' },
                },
              },
              examples: {
                default: {
                  value: {
                    email: 'netzplanung@twl.de',
                    onlyOnChanges: true,
                    language: 'de',
                  },
                },
              },
            },
          },
        },
      },
      params: {
        watchId: { type: 'string', min: 1 },
        email: { type: 'email' },
        onlyOnChanges: { type: 'boolean', optional: true, default: true },
        language: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
      },
      async handler(ctx) {
        const watch = await this.getPayload(WATCHES_NAMESPACE, ctx.params.watchId);
        if (!watch) {
          throw new MoleculerClientError('Watch not found', 404, 'WATCH_NOT_FOUND');
        }

        const token = crypto.randomBytes(24).toString('hex');
        const tokenHash = hashToken(token);
        const now = toIsoNow();

        const sub = {
          watchId: ctx.params.watchId,
          email: ctx.params.email,
          channel: 'email',
          onlyOnChanges: ctx.params.onlyOnChanges !== false,
          language: ctx.params.language || 'de',
          status: 'pending_confirmation',
          tokenHash,
          createdAt: now,
          updatedAt: now,
        };
        await this.putObject(SUBSCRIPTIONS_NAMESPACE, `${ctx.params.watchId}:${tokenHash}`, sub);

        this.subscribe_sendConfirmation({ ...sub, token }, watch).catch((err) =>
          this.logger.warn('[mastr-monitor] sendConfirmationEmail failed:', err.message)
        );

        return {
          success: true,
          status: 'pending_confirmation',
          message: `Bestätigungslink wurde an ${ctx.params.email} gesendet.`,
          token,
        };
      },
    },

    unsubscribe: {
      rest: 'DELETE /watches/:watchId/subscribe/:token',
      openapi: {
        summary: 'Unsubscribe token',
        tags: ['MaStR Monitor'],
      },
      params: {
        watchId: { type: 'string', min: 1 },
        token: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const tokenHash = hashToken(ctx.params.token);
        const key = `${ctx.params.watchId}:${tokenHash}`;
        const existing = await this.getPayload(SUBSCRIPTIONS_NAMESPACE, key);
        if (!existing) {
          throw new MoleculerClientError('Subscription not found', 404, 'SUBSCRIPTION_NOT_FOUND');
        }

        await this.broker.call('object-store.delete', {
          namespace: SUBSCRIPTIONS_NAMESPACE,
          key,
        });

        return { success: true };
      },
    },

    confirmSubscription: {
      rest: 'GET /confirm/:token',
      openapi: {
        summary: 'Confirm email subscription by token',
        tags: ['MaStR Monitor'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string', example: 'd6f47d6d687adc8f8e5a17f6b63dd3f31fc14e8f67122e4a' } },
        ],
      },
      params: {
        token: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const tokenHash = hashToken(ctx.params.token);
        const subs = await this.queryObjects(SUBSCRIPTIONS_NAMESPACE, {
          'payload.tokenHash': tokenHash,
        });
        const hit = subs[0] || null;

        if (!hit) {
          throw new MoleculerClientError('Subscription token not found', 404, 'TOKEN_NOT_FOUND');
        }

        const updated = {
          ...hit.payload,
          status: 'confirmed',
          confirmedAt: toIsoNow(),
          updatedAt: toIsoNow(),
        };

        await this.putObject(SUBSCRIPTIONS_NAMESPACE, hit.key, updated);

        ctx.meta.$responseType = 'text/html; charset=utf-8';
        return [
          '<!doctype html>',
          '<html lang="de">',
          '<head><meta charset="utf-8"><title>MaStR Monitoring</title></head>',
          '<body>',
          '<h1>✅ Anmeldung bestätigt</h1>',
          '<p>Ihre Email-Benachrichtigung wurde erfolgreich aktiviert.</p>',
          '</body>',
          '</html>',
        ].join('');
      },
    },

    createFromSession: {
      rest: 'POST /from-session',
      openapi: {
        summary: 'Create watch from Live-CSV session (stub)',
        tags: ['MaStR Monitor'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
              },
              examples: {
                default: {
                  value: {
                    sessionId: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
                    name: 'Monitoring aus CSV-Session',
                  },
                },
              },
            },
          },
        },
      },
      async handler() {
        return { status: 'stub', message: 'Prompt 4 implementiert die Integration' };
      },
    },
  },

  methods: {
    async checkScheduledWatches() {
      let watches;
      try {
        watches = await this.listPayloads(WATCHES_NAMESPACE);
      } catch (err) {
        this.logger.error('[mastr-monitor] checkScheduledWatches: listPayloads failed:', err.message);
        return;
      }

      const now = new Date();
      for (const watch of watches) {
        if (!watch?.watchId || !watch?.schedule) continue;
        if (!isDue(watch.schedule, watch.lastRun, now)) continue;

        this.logger.info(`[mastr-monitor] Scheduled run for watch: ${watch.watchId}`);
        this.executeWatch(watch.watchId, {}).catch((err) =>
          this.logger.error(`[mastr-monitor] Scheduled executeWatch failed for ${watch.watchId}:`, err.message)
        );
      }
    },

    async loadConfirmedSubscriptions(watchId) {
      const docs = await this.listPayloads(SUBSCRIPTIONS_NAMESPACE);
      return docs.filter((p) => p && p.watchId === watchId && p.status === 'confirmed');
    },

    async notifyDelta(watchId, watch, delta) {
      if (!isSmtpConfigured()) return;

      let subs;
      try {
        subs = await this.loadConfirmedSubscriptions(watchId);
      } catch (err) {
        this.logger.warn(`[mastr-monitor] notifyDelta: loadConfirmedSubscriptions failed: ${err.message}`);
        return;
      }

      for (const sub of subs) {
        try {
          if (delta && (delta.summary.added > 0 || delta.summary.changed > 0 || delta.summary.removed > 0)) {
            await sendDeltaNotification(sub, watch, delta);
          } else if (!sub.onlyOnChanges) {
            const { sendNoChangesNotification } = require('../src/mastr-monitor-notify');
            await sendNoChangesNotification(sub, watch);
          }
        } catch (err) {
          this.logger.warn(`[mastr-monitor] notifyDelta: send failed for ${sub.email}: ${err.message}`);
        }
      }
    },

    async subscribe_sendConfirmation(subscription, watch) {
      if (!isSmtpConfigured()) {
        this.logger.debug('[mastr-monitor] SMTP not configured — skipping confirmation email.');
        return;
      }
      try {
        await sendConfirmationEmail(subscription, watch);
      } catch (err) {
        this.logger.warn(`[mastr-monitor] sendConfirmationEmail failed for ${subscription.email}: ${err.message}`);
      }
    },

    buildWatchTokenUrl(rawToken) {
      const baseUrl = String(process.env.MASTR_MONITOR_BASE_URL || 'https://api.cernion.de').replace(/\/$/, '');
      return `${baseUrl}/api/mastr-monitor/watch/${rawToken}`;
    },

    resolveSchedule(scheduleInput) {
      const input = scheduleInput || this.settings.defaultSchedule;
      const timezone = input.timezone || 'Europe/Berlin';

      if (input.type === 'cron') {
        if (!input.expression || typeof input.expression !== 'string') {
          throw new MoleculerClientError('Missing cron expression', 422, 'INVALID_SCHEDULE');
        }
        if (!isAtMostDailyCron(input.expression)) {
          throw new MoleculerClientError(
            'Invalid schedule: minimum monitoring interval is daily (once per day).',
            422,
            'INVALID_SCHEDULE'
          );
        }
        return {
          type: 'cron',
          expression: input.expression,
          timezone,
        };
      }

      const preset = input.preset || this.settings.defaultSchedule.preset;
      const expression = this.settings.schedulePresets[preset];
      if (!expression) {
        throw new MoleculerClientError('Invalid schedule preset', 422, 'INVALID_SCHEDULE');
      }

      return {
        type: 'preset',
        preset,
        expression,
        timezone,
      };
    },

    async startBaselineSnapshotJob(watchId) {
      const pseudoCtx = {
        meta: { $gateway: true },
      };

      return startJob(
        pseudoCtx,
        { service: 'mastr-monitor', action: 'baseline' },
        async () => this.executeWatch(watchId, {})
      );
    },

    async executeWatch(watchId, meta = {}) {
      const watchDoc = await this.broker.call('object-store.get', {
        namespace: WATCHES_NAMESPACE,
        key: watchId,
      });
      const watch = watchDoc?.payload || null;
      if (!watch) {
        throw new MoleculerClientError('Watch not found', 404, 'WATCH_NOT_FOUND');
      }

      const rows = await this.fetchInstallationsForWatch(watch, meta);
      const entries = rows.map((inst) => buildSnapshotEntry(inst, watch.watchFields || []));

      const nowIso = toIsoNow();
      const snapshotKey = `${watchId}:${nowIso.split('T')[0]}`;
      const snapshot = {
        watchId,
        snapshotKey,
        entries,
        count: entries.length,
        timestamp: nowIso,
      };

      const watchStillExistsBeforeSnapshot = await this.getPayload(WATCHES_NAMESPACE, watchId);
      if (!watchStillExistsBeforeSnapshot) {
        return {
          watchId,
          snapshot: { count: entries.length },
          delta: null,
          aborted: true,
        };
      }

      const prevSnapshots = await this.listDocsByPrefix(SNAPSHOTS_NAMESPACE, `${watchId}:`);
      const prevSnapshotDoc = prevSnapshots
        .sort((a, b) => String(b.key || '').localeCompare(String(a.key || '')))[0] || null;
      const prevSnapshot = await this.hydrateSnapshotPayload(prevSnapshotDoc?.payload || null);

      await this.persistSnapshot(snapshotKey, snapshot);

      let delta = null;
      if (Array.isArray(prevSnapshot?.entries)) {
        delta = computeDelta(prevSnapshot.entries, entries, watch.watchFields || []);
        delta.watchId = watchId;
        delta.deltaId = snapshotKey.split(':')[1];
        delta.deltaKey = snapshotKey;
        delta.baseline = prevSnapshot.timestamp || null;

        await this.persistDelta(snapshotKey, delta);
      }

      const watchStillExistsBeforeUpdate = await this.getPayload(WATCHES_NAMESPACE, watchId);
      if (!watchStillExistsBeforeUpdate) {
        return {
          watchId,
          snapshot: { count: entries.length },
          delta: delta?.summary || null,
          aborted: true,
        };
      }

      const updatedWatch = {
        ...watchStillExistsBeforeUpdate,
        lastRun: nowIso,
        installationCount: entries.length,
        lastDelta: delta ? delta.summary : null,
        status: 'active',
        updatedAt: nowIso,
      };
      await this.putObject(WATCHES_NAMESPACE, watchId, updatedWatch);

      await this.cleanupOldSnapshots(watchId);
      await this.cleanupOldDeltas(watchId);

      if (
        delta &&
        (delta.summary.added > 0 || delta.summary.changed > 0 || delta.summary.removed > 0)
      ) {
        this.broker.emit('mastr-monitor.delta.detected', { watchId, delta });
        this.notifyDelta(watchId, updatedWatch, delta).catch((err) =>
          this.logger.warn('[mastr-monitor] notifyDelta error:', err.message)
        );
      } else if (delta) {
        // no changes — notify subscribers who opted in for all runs
        this.notifyDelta(watchId, updatedWatch, null).catch((err) =>
          this.logger.warn('[mastr-monitor] notifyDelta (no-changes) error:', err.message)
        );
      }

      return {
        watchId,
        snapshot: { count: entries.length },
        delta: delta?.summary || null,
      };
    },

    async cleanupOldSnapshots(watchId) {
      const snapshots = await this.listDocsByPrefix(SNAPSHOTS_NAMESPACE, `${watchId}:`);
      const sorted = snapshots.sort((a, b) => String(b.key || '').localeCompare(String(a.key || '')));
      if (sorted.length <= this.settings.snapshotRetention) return;

      const deletions = sorted.slice(this.settings.snapshotRetention);
      for (const item of deletions) {
        await this.broker.call('object-store.delete', {
          namespace: SNAPSHOTS_NAMESPACE,
          key: item.key,
        });
        await this.deleteByPrefix(SNAPSHOT_CHUNKS_NAMESPACE, `${item.key}:part:`);
      }
    },

    async cleanupOldDeltas(watchId) {
      const deltas = await this.listDocsByPrefix(DELTAS_NAMESPACE, `${watchId}:`);
      const cutoffMs = Date.now() - this.settings.deltaRetentionDays * 24 * 60 * 60 * 1000;
      for (const item of deltas) {
        const ts = item?.payload?.timestamp;
        const ms = ts ? Date.parse(ts) : NaN;
        if (Number.isNaN(ms) || ms >= cutoffMs) continue;
        await this.broker.call('object-store.delete', {
          namespace: DELTAS_NAMESPACE,
          key: item.key,
        });
        await this.deleteByPrefix(DELTA_CHUNKS_NAMESPACE, `${item.key}:`);
      }
    },

    async getPayload(namespace, key) {
      try {
        const doc = await this.broker.call('object-store.get', { namespace, key });
        return doc?.payload || null;
      } catch (err) {
        if (err?.code === 404 || err?.type === 'OBJECT_NOT_FOUND') return null;
        throw err;
      }
    },

    async putObject(namespace, key, payload) {
      return this.broker.call('object-store.put', { namespace, key, payload });
    },

    mapWatchQueryToEnergyMarketParams(query = {}, installationType, limitOverride) {
      const params = {
        installationType,
        gridOperatorMastrId: query.gridOperatorMastrId,
        gridOperatorBdewCode: query.gridOperatorBdewCode,
        minCapacityKW: query.minCapacity,
        maxCapacityKW: query.maxCapacity,
        operationalStatus: query.status,
        postleitzahl: query.postleitzahl,
        location: query.gemeinde || query.landkreis || query.bundesland,
        netzbetreiberPruefungStatus: query.netzbetreiberPruefungStatus,
        format: 'json',
        limit: Number(limitOverride) > 0 ? Number(limitOverride) : this.settings.maxInstallationsPerWatch,
      };

      // Remove undefined/null/empty values to avoid downstream validation errors
      // in energy-market.installations (Fastest-Validator).
      return Object.fromEntries(
        Object.entries(params).filter(([, value]) => {
          if (value === undefined || value === null) return false;
          if (typeof value === 'string' && value.trim() === '') return false;
          return true;
        })
      );
    },

    async fetchInstallationsForWatch(watch, meta = {}) {
      const requestedType = watch?.query?.type || 'all';
      const types =
        requestedType === 'all'
          ? ['solar', 'wind', 'storage', 'biomass']
          : [requestedType];

      const allRows = [];
      let remaining = this.settings.maxInstallationsPerWatch;

      for (const type of types) {
        if (remaining <= 0) break;

        const result = await this.broker.call(
          'energy-market.installations',
          this.mapWatchQueryToEnergyMarketParams(watch.query || {}, type, remaining),
          { meta }
        );
        const rows = result?.data?.installations || result?.installations || [];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const slice = rows.slice(0, remaining);
        allRows.push(...slice);
        remaining -= slice.length;
      }

      return allRows;
    },

    createChunks(items = []) {
      const chunkSize = Math.max(1, Number(this.settings.chunkSize) || 1000);
      const chunks = [];
      for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
      }
      return chunks;
    },

    shouldChunkSnapshot(snapshot) {
      return !!(this.settings.chunkingEnabled && Array.isArray(snapshot?.entries) && snapshot.entries.length > this.settings.chunkSize);
    },

    shouldChunkDelta(delta) {
      if (!this.settings.chunkingEnabled || !delta) return false;
      const added = Array.isArray(delta.added) ? delta.added.length : 0;
      const changed = Array.isArray(delta.changed) ? delta.changed.length : 0;
      const removed = Array.isArray(delta.removed) ? delta.removed.length : 0;
      return added > this.settings.chunkSize || changed > this.settings.chunkSize || removed > this.settings.chunkSize;
    },

    async persistSnapshot(snapshotKey, snapshot) {
      if (!this.shouldChunkSnapshot(snapshot)) {
        await this.deleteByPrefix(SNAPSHOT_CHUNKS_NAMESPACE, `${snapshotKey}:part:`);
        await this.putObject(SNAPSHOTS_NAMESPACE, snapshotKey, { ...snapshot, chunked: false });
        return;
      }

      await this.deleteByPrefix(SNAPSHOT_CHUNKS_NAMESPACE, `${snapshotKey}:part:`);

      const chunks = this.createChunks(snapshot.entries || []);
      for (let i = 0; i < chunks.length; i += 1) {
        await this.putObject(SNAPSHOT_CHUNKS_NAMESPACE, `${snapshotKey}:part:${String(i).padStart(6, '0')}`, {
          watchId: snapshot.watchId,
          snapshotKey,
          index: i,
          entries: chunks[i],
          createdAt: snapshot.timestamp,
        });
      }

      const manifest = {
        watchId: snapshot.watchId,
        snapshotKey,
        timestamp: snapshot.timestamp,
        count: snapshot.count,
        chunked: true,
        chunkSize: this.settings.chunkSize,
        chunkCount: chunks.length,
      };
      await this.putObject(SNAPSHOTS_NAMESPACE, snapshotKey, manifest);
    },

    async persistDelta(deltaKey, delta) {
      if (!this.shouldChunkDelta(delta)) {
        await this.deleteByPrefix(DELTA_CHUNKS_NAMESPACE, `${deltaKey}:`);
        await this.putObject(DELTAS_NAMESPACE, deltaKey, { ...delta, chunked: false });
        return;
      }

      await this.deleteByPrefix(DELTA_CHUNKS_NAMESPACE, `${deltaKey}:`);

      const sections = ['added', 'changed', 'removed'];
      for (const section of sections) {
        const rows = Array.isArray(delta[section]) ? delta[section] : [];
        const chunks = this.createChunks(rows);
        for (let i = 0; i < chunks.length; i += 1) {
          await this.putObject(DELTA_CHUNKS_NAMESPACE, `${deltaKey}:${section}:${String(i).padStart(6, '0')}`, {
            watchId: delta.watchId,
            deltaKey,
            section,
            index: i,
            items: chunks[i],
            timestamp: delta.timestamp,
          });
        }
      }

      const manifest = {
        watchId: delta.watchId,
        deltaId: delta.deltaId,
        deltaKey,
        baseline: delta.baseline || null,
        timestamp: delta.timestamp,
        summary: delta.summary || { added: 0, changed: 0, removed: 0 },
        chunked: true,
        chunkSize: this.settings.chunkSize,
      };
      await this.putObject(DELTAS_NAMESPACE, deltaKey, manifest);
    },

    async hydrateSnapshotPayload(snapshot) {
      if (!snapshot) return null;
      if (!snapshot.chunked) return snapshot;

      const snapshotKey = snapshot.snapshotKey || `${snapshot.watchId}:${String(snapshot.timestamp || '').split('T')[0]}`;
      if (!snapshotKey) return { ...snapshot, entries: [] };

      const chunkDocs = await this.listDocsByPrefix(SNAPSHOT_CHUNKS_NAMESPACE, `${snapshotKey}:part:`);
      const entries = chunkDocs
        .sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')))
        .flatMap((doc) => Array.isArray(doc?.payload?.entries) ? doc.payload.entries : []);

      return {
        ...snapshot,
        entries,
        count: Number(snapshot.count || entries.length),
      };
    },

    async hydrateDeltaPayload(delta) {
      if (!delta) return null;
      if (!delta.chunked) return delta;

      const deltaKey = delta.deltaKey || (delta.watchId && delta.deltaId ? `${delta.watchId}:${delta.deltaId}` : null);
      if (!deltaKey) {
        return {
          ...delta,
          added: [],
          changed: [],
          removed: [],
        };
      }

      const readSection = async (section) => {
        const docs = await this.listDocsByPrefix(DELTA_CHUNKS_NAMESPACE, `${deltaKey}:${section}:`);
        return docs
          .sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')))
          .flatMap((doc) => Array.isArray(doc?.payload?.items) ? doc.payload.items : []);
      };

      const [added, changed, removed] = await Promise.all([
        readSection('added'),
        readSection('changed'),
        readSection('removed'),
      ]);

      return {
        ...delta,
        added,
        changed,
        removed,
      };
    },

    async queryObjects(namespace, selector = {}, limit = 1000, skip = 0) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 1000));
      const result = await this.broker.call('object-store.query', {
        namespace,
        selector,
        limit: safeLimit,
        skip,
      });
      return Array.isArray(result?.docs) ? result.docs : [];
    },

    async listAllDocs(namespace) {
      const pageSize = 1000;
      const docs = [];
      let skip = 0;
      while (true) {
        const page = await this.queryObjects(namespace, {}, pageSize, skip);
        if (!Array.isArray(page) || page.length === 0) break;
        docs.push(...page);
        if (page.length < pageSize) break;
        skip += page.length;
      }
      return docs;
    },

    async listPayloads(namespace) {
      const docs = await this.listAllDocs(namespace);
      return docs.map((doc) => doc.payload).filter(Boolean);
    },

    async listByPrefix(namespace, keyPrefix) {
      const docs = await this.listDocsByPrefix(namespace, keyPrefix);
      return docs.map((doc) => doc.payload).filter(Boolean);
    },

    async listDocsByPrefix(namespace, keyPrefix) {
      const docs = await this.listAllDocs(namespace);
      return docs.filter((doc) => String(doc.key || '').startsWith(keyPrefix));
    },

    async deleteByPrefix(namespace, keyPrefix) {
      const docs = await this.listDocsByPrefix(namespace, keyPrefix);
      for (const doc of docs) {
        await this.broker.call('object-store.delete', {
          namespace,
          key: doc.key,
        });
      }
    },
  },
};
