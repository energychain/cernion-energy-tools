const fs = require('fs');
const path = require('path');

function toAbsWatchDir(watchDir) {
  if (path.isAbsolute(watchDir)) return watchDir;
  return path.resolve(process.cwd(), watchDir);
}

function normalizeFilePath(value) {
  return path.normalize(String(value || ''));
}

module.exports = {
  name: 'datasource-watcher',

  settings: {
    watchDir: process.env.UPLOADS_DIR || './uploads',
    debounceMs: 2000,
    autoRebuildOnStart: process.env.NODE_ENV === 'test' ? false : true,
  },

  dependencies: ['datasource-registry', 'datasource-cache'],

  actions: {
    status: {
      rest: 'GET /status',
      openapi: {
        summary: 'Get datasource watcher status',
        tags: ['DataSources'],
      },
      handler() {
        return this.getWatcherStatus();
      },
    },
  },

  methods: {
    getWatcherStatus() {
      const mappings = Array.from(this.fileToSources.entries()).map(([filePath, sourceIds]) => ({
        filename: path.basename(filePath),
        sourceIds: [...sourceIds],
      }));

      return {
        watching: Boolean(this.watcher),
        watchDir: this.settings.watchDir,
        trackedFiles: mappings.length,
        mappings,
      };
    },

    async rebuildMappings() {
      const response = await this.broker.call('datasource-registry.list', {});
      const sources = Array.isArray(response?.data) ? response.data : [];
      const nextMap = new Map();
      const watchAbs = toAbsWatchDir(this.settings.watchDir);

      for (const source of sources) {
        const filePath =
          source?.connectorConfig?.path ||
          source?.connectorConfig?.filePath ||
          source?.connectorConfig?.filename;
        if (!filePath) continue;

        const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        if (path.dirname(abs) !== watchAbs) continue;

        const normalized = normalizeFilePath(abs);
        if (!nextMap.has(normalized)) nextMap.set(normalized, new Set());
        nextMap.get(normalized).add(source.id || source.sourceId);
      }

      this.fileToSources = nextMap;
      this.logger.info('[datasource-watcher] mappings rebuilt', {
        trackedFiles: this.fileToSources.size,
      });

      return sources;
    },

    async rebuildCachesOnStart(sources) {
      if (!this.settings.autoRebuildOnStart) {
        this.logger.info('[datasource-watcher] startup cache rebuild disabled');
        return;
      }

      const items = Array.isArray(sources) ? sources : [];
      let refreshedCount = 0;

      for (const source of items) {
        const sourceId = source?.id || source?.sourceId;
        if (!sourceId) continue;

        try {
          const status = await this.broker.call('datasource-cache.status', { sourceId });
          const shouldRefresh = !status?.exists || status?.stale;
          if (!shouldRefresh) continue;

          await this.broker.call('datasource-cache.refresh', { sourceId });
          refreshedCount += 1;
        } catch (error) {
          this.logger.warn('[datasource-watcher] startup cache refresh failed', {
            sourceId,
            message: error.message,
          });
        }
      }

      this.logger.info('[datasource-watcher] startup cache rebuild complete', {
        totalSources: items.length,
        refreshedCount,
      });
    },

    scheduleFileChange(absPath) {
      const normalized = normalizeFilePath(absPath);
      if (!this.fileToSources.has(normalized)) return;

      if (this.debounceTimers.has(normalized)) {
        clearTimeout(this.debounceTimers.get(normalized));
      }

      const timer = setTimeout(async () => {
        this.debounceTimers.delete(normalized);
        await this.onFileChange(normalized);
      }, this.settings.debounceMs);

      this.debounceTimers.set(normalized, timer);
    },

    async onFileChange(filePath) {
      const sourceIds = this.fileToSources.get(filePath);
      if (!sourceIds || sourceIds.size === 0) return;

      const filename = path.basename(filePath);
      for (const sourceId of sourceIds) {
        try {
          await this.broker.call('datasource-cache.refresh', { sourceId });
          this.broker.emit('datasource.file.refreshed', { sourceId, filename });
          this.logger.info('[datasource-watcher] source refreshed', { sourceId, filename });
        } catch (error) {
          this.logger.warn('[datasource-watcher] refresh failed', {
            sourceId,
            filename,
            message: error.message,
          });
        }
      }
    },

    startWatcher() {
      const watchAbs = toAbsWatchDir(this.settings.watchDir);
      fs.mkdirSync(watchAbs, { recursive: true });

      if (this.watcher) {
        this.watcher.close();
        this.watchers.delete(this.watcher);
        this.watcher = null;
      }

      this.watcher = fs.watch(watchAbs, (_eventType, filename) => {
        if (!filename) return;
        const absPath = path.join(watchAbs, String(filename));
        this.scheduleFileChange(absPath);
      });
      this.watchers.add(this.watcher);

      this.logger.info('[datasource-watcher] watcher started', {
        watchDir: this.settings.watchDir,
      });
    },
  },

  async created() {
    this.fileToSources = new Map();
    this.debounceTimers = new Map();
    this.watcher = null;
    this.watchers = new Set();
  },

  async started() {
    const sources = await this.rebuildMappings();
    await this.rebuildCachesOnStart(sources);
    this.startWatcher();
  },

  async stopped() {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    this.watcher = null;
  },
};
