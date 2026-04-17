'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { startJob } = require('../src/job-store');
const { computeDelta, buildSnapshotEntry } = require('../src/mastr-monitor-diff');
const { isDue } = require('../src/mastr-monitor-scheduler');
const { isSmtpConfigured, sendDeltaNotification, sendConfirmationEmail } = require('../src/mastr-monitor-notify');

const WATCHES_NAMESPACE = 'mastr_watches';
const SNAPSHOTS_NAMESPACE = 'mastr_snapshots';
const DELTAS_NAMESPACE = 'mastr_deltas';
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
    maxInstallationsPerWatch: 5000,
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
        await this.deleteByPrefix(DELTAS_NAMESPACE, `${ctx.params.watchId}:`);
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
        const deltas = await this.listByPrefix(DELTAS_NAMESPACE, `${ctx.params.watchId}:`);
        const sorted = deltas.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        return {
          watchId: ctx.params.watchId,
          deltas: sorted,
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
        return delta;
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
        const snapshots = await this.listByPrefix(SNAPSHOTS_NAMESPACE, `${ctx.params.watchId}:`);
        const latest = pickLatestByTimestamp(snapshots, 'timestamp');
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
      const docs = await this.queryObjects(SUBSCRIPTIONS_NAMESPACE, {}, 1000, 0);
      return docs
        .map((d) => d?.payload)
        .filter((p) => p && p.watchId === watchId && p.status === 'confirmed');
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
      const prevSnapshot = prevSnapshots
        .sort((a, b) => String(b.key || '').localeCompare(String(a.key || '')))[0]?.payload || null;

      await this.putObject(SNAPSHOTS_NAMESPACE, snapshotKey, snapshot);

      let delta = null;
      if (prevSnapshot?.entries) {
        delta = computeDelta(prevSnapshot.entries, entries, watch.watchFields || []);
        delta.watchId = watchId;
        delta.deltaId = snapshotKey.split(':')[1];
        delta.baseline = prevSnapshot.timestamp || null;

        await this.putObject(DELTAS_NAMESPACE, snapshotKey, delta);
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

    mapWatchQueryToEnergyMarketParams(query = {}, installationType) {
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
        limit: this.settings.maxInstallationsPerWatch,
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
      for (const type of types) {
        const result = await this.broker.call(
          'energy-market.installations',
          this.mapWatchQueryToEnergyMarketParams(watch.query || {}, type),
          { meta }
        );
        const rows = result?.data?.installations || result?.installations || [];
        allRows.push(...rows);
      }

      return allRows.slice(0, this.settings.maxInstallationsPerWatch);
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

    async listPayloads(namespace) {
      const docs = await this.queryObjects(namespace, {}, 1000, 0);
      return docs.map((doc) => doc.payload).filter(Boolean);
    },

    async listByPrefix(namespace, keyPrefix) {
      const docs = await this.listDocsByPrefix(namespace, keyPrefix);
      return docs.map((doc) => doc.payload).filter(Boolean);
    },

    async listDocsByPrefix(namespace, keyPrefix) {
      const docs = await this.queryObjects(namespace, {}, 5000, 0);
      return docs.filter((doc) => String(doc.key || '').startsWith(keyPrefix));
    },

    async deleteByPrefix(namespace, keyPrefix) {
      const docs = await this.queryObjects(namespace, {}, 1000, 0);
      const hits = docs.filter((doc) => String(doc.key || '').startsWith(keyPrefix));
      for (const doc of hits) {
        await this.broker.call('object-store.delete', {
          namespace,
          key: doc.key,
        });
      }
    },
  },
};
