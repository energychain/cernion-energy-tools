const { listSemanticDomains, semanticDomains } = require('../src/semantic-domains');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeToken(value).replace(/\s+/g, '');
}

function tokenize(value) {
  return normalizeToken(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function inferValueKind(value) {
  if (value === null || value === undefined) return 'empty';
  const text = String(value).trim();
  if (!text) return 'empty';
  if (/^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}(?::\d{2})?)?/i.test(text)) return 'timestamp';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}(?:\s\d{1,2}:\d{2})?$/.test(text)) return 'timestamp';
  if (/^\d{4}-(?:q[1-4]|\d{2})\s*(?:\/|to|-)?\s*(?:\d{4}-(?:q[1-4]|\d{2}))?$/i.test(text))
    return 'date-range';
  if (/^(?:q[1-4]\s*\d{4}|\d{4}\s*q[1-4])$/i.test(text)) return 'date-range';
  if (/^-?\d+[,.]\d+$/.test(text)) return 'float';
  if (/^-?\d+$/.test(text)) return 'integer';
  if (/^(?:DE\d{10,}|S(?:EE|WE|AN|NB)[A-Z0-9]+|[A-Z]{2,}\d{2,})$/i.test(text)) return 'idlike';
  return 'string';
}

function buildColumnProfiles(rows, dictionaryFields = []) {
  const fieldMap = new Map((dictionaryFields || []).map((field) => [field.name, field]));
  const sampleRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
  const columnNames = Object.keys(sampleRow || {});

  return columnNames.map((columnName) => {
    const values = rows
      .slice(0, 10)
      .map((row) => row?.[columnName])
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const kindVotes = new Map();
    values.forEach((value) => {
      const kind = inferValueKind(value);
      kindVotes.set(kind, (kindVotes.get(kind) || 0) + 1);
    });

    let dominantKind = 'string';
    let maxVotes = -1;
    for (const [kind, votes] of kindVotes.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        dominantKind = kind;
      }
    }

    return {
      columnName,
      normalized: normalizeKey(columnName),
      tokens: tokenize(columnName),
      dominantKind,
      sampleValues: values.slice(0, 3),
      fieldMeta: fieldMap.get(columnName) || null,
    };
  });
}

function matchRatio(matches, total) {
  if (!total) return 0;
  return Math.min(1, matches / total);
}

function findMatchingCount(haystack, needles) {
  if (!Array.isArray(needles) || needles.length === 0) return 0;
  const text = Array.isArray(haystack) ? haystack.join(' ') : String(haystack || '');
  return needles.filter(
    (needle) => text.includes(normalizeKey(needle)) || text.includes(normalizeToken(needle))
  ).length;
}

function scoreCandidate(profile, columnProfile) {
  let score = 0;
  const aliases = uniq([profile.role, ...(profile.aliases || [])]);
  const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
  const fuzzyAliases = normalizedAliases.filter((alias) => alias.length >= 4);

  if (columnProfile.fieldMeta?.semanticRole === profile.role) score += 1;
  if (normalizedAliases.includes(columnProfile.normalized)) score += 0.95;
  if (
    fuzzyAliases.some(
      (alias) =>
        columnProfile.normalized.includes(alias) || alias.includes(columnProfile.normalized)
    )
  )
    score += 0.55;
  if ((profile.expectedKinds || []).includes(columnProfile.dominantKind)) score += 0.3;
  if (
    (profile.expectedKinds || []).includes('string') &&
    columnProfile.dominantKind === 'date-range'
  )
    score += 0.08;

  return Math.min(1, score);
}

function buildRoleProfiles(domain) {
  return (domain.indicators?.criticalFields || []).map((role) => ({
    role,
    ...(domain.fieldProfiles?.[role] || {}),
  }));
}

module.exports = {
  name: 'datasource-classifier',

  settings: {
    sampleSize: 50,
    confidenceThreshold: 0.65,
    unknownThreshold: 0.28,
  },

  dependencies: ['datasource-cache', 'datasource-registry'],

  actions: {
    classify: {
      params: {
        sourceId: { type: 'string' },
        filename: { type: 'string', optional: true },
        description: { type: 'string', optional: true },
        domainId: { type: 'string', optional: true },
        fieldMappings: { type: 'object', optional: true },
        confirmedByUser: { type: 'boolean', optional: true, convert: true },
      },
      async handler(ctx) {
        return this.classifySource(ctx, {
          sourceId: ctx.params.sourceId,
          filename: ctx.params.filename,
          description: ctx.params.description,
          forcedDomainId: ctx.params.domainId,
          fieldMappings: ctx.params.fieldMappings,
          confirmedByUser: ctx.params.confirmedByUser,
        });
      },
    },

    confirm: {
      rest: 'PATCH /datasources/:id/classification',
      params: {
        id: { type: 'string', optional: true },
        sourceId: { type: 'string', optional: true },
        domainId: { type: 'string' },
        fieldMappings: { type: 'object', optional: true },
        confirmedByUser: { type: 'boolean', optional: true, convert: true },
      },
      openapi: {
        summary: 'Confirm or correct semantic datasource classification',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId || ctx.params.id;
        const classification = await this.classifySource(ctx, {
          sourceId,
          forcedDomainId: ctx.params.domainId,
          fieldMappings: ctx.params.fieldMappings || {},
          confirmedByUser: ctx.params.confirmedByUser !== false,
        });

        const persistResult = await ctx.call('datasource-registry.updateClassification', {
          sourceId,
          classification,
          fieldMappings: classification.fieldMappings || {},
          confirmedByUser: classification.confirmedByUser === true,
        });

        return {
          success: true,
          data: persistResult.data,
          availableDomains: listSemanticDomains(),
        };
      },
    },
  },

  events: {
    async 'datasource.inference.complete'(ctx) {
      const { sourceId, filename, description } = ctx.params;
      try {
        const classification = await ctx.call('datasource-classifier.classify', {
          sourceId,
          filename,
          description,
        });

        await ctx.call('datasource-registry.updateClassification', {
          sourceId,
          classification,
          fieldMappings: classification.fieldMappings || {},
          confirmedByUser: false,
        });
      } catch (error) {
        this.logger.error('Classification failed', { sourceId, message: error.message });
      }
    },
  },

  methods: {
    async classifySource(ctx, options) {
      const source = await this.loadSource(ctx, options.sourceId);
      const filename =
        options.filename ||
        source.connectorConfig?.path ||
        source.connectorConfig?.filePath ||
        source.name ||
        '';
      const description =
        options.description !== undefined ? options.description : source.description || '';
      const rows = await this.loadRows(ctx, options.sourceId);
      const columnProfiles = buildColumnProfiles(rows, source.dictionary?.fields || []);
      const metadataTokens = uniq([...tokenize(filename), ...tokenize(description)]);

      const scores = semanticDomains
        .map((domain) => {
          const filenameHits = findMatchingCount(
            metadataTokens.join(' '),
            domain.indicators?.filenameTokens || []
          );
          const filenameScore = matchRatio(
            filenameHits,
            Math.max(1, (domain.indicators?.filenameTokens || []).length)
          );

          const keywordHits = columnProfiles.filter((columnProfile) =>
            (domain.indicators?.columnKeywords || []).some((keyword) => {
              const normalizedKeyword = normalizeKey(keyword);
              return (
                columnProfile.normalized.includes(normalizedKeyword) ||
                normalizedKeyword.includes(columnProfile.normalized)
              );
            })
          ).length;
          const columnScore = matchRatio(
            keywordHits,
            Math.max(
              1,
              Math.min(columnProfiles.length, (domain.indicators?.columnKeywords || []).length)
            )
          );

          const roleProfiles = buildRoleProfiles(domain);
          const roleMatches = roleProfiles.map((roleProfile) => {
            const best = [...columnProfiles]
              .map((columnProfile) => ({
                columnName: columnProfile.columnName,
                score: scoreCandidate(roleProfile, columnProfile),
              }))
              .sort((left, right) => right.score - left.score)[0];
            return best?.score || 0;
          });
          const typeScore =
            roleMatches.length > 0
              ? roleMatches.reduce((sum, value) => sum + value, 0) / roleMatches.length
              : 0;

          const baseScore = filenameScore * 0.35 + columnScore * 0.45 + typeScore * 0.2;
          const confidenceBoost =
            (filenameScore >= 0.3 ? 0.08 : 0) +
            (columnScore >= 0.45 ? 0.04 : 0) +
            (typeScore >= 0.55 ? 0.03 : 0);
          const totalScore = Number(Math.min(1, baseScore + confidenceBoost).toFixed(4));
          return {
            domain,
            score: totalScore,
          };
        })
        .sort((left, right) => right.score - left.score);

      const preferredDomain = options.forcedDomainId
        ? scores.find((entry) => entry.domain.id === options.forcedDomainId)
        : scores[0];
      const winningEntry = options.forcedDomainId
        ? preferredDomain || null
        : preferredDomain && preferredDomain.score >= this.settings.unknownThreshold
          ? preferredDomain
          : null;

      if (!winningEntry) {
        return {
          domainId: 'unknown',
          domainLabel: 'Unknown Domain',
          confidence: Number((scores[0]?.score || 0).toFixed(2)),
          alternativeDomains: scores.slice(0, 2).map((entry) => ({
            domainId: entry.domain.id,
            domainLabel: entry.domain.label,
            confidence: Number(entry.score.toFixed(2)),
          })),
          criticalFieldStatus: [],
          fieldMappings: {},
          requiresUserInput: true,
          confirmedByUser: options.confirmedByUser === true,
          resolvedAt: nowIso(),
        };
      }

      const domain = winningEntry.domain;
      const classification = this.buildClassificationForDomain({
        domain,
        confidence: winningEntry.score,
        scores,
        source,
        columnProfiles,
        fieldMappings: options.fieldMappings || {},
        confirmedByUser: options.confirmedByUser === true,
      });

      return classification;
    },

    buildClassificationForDomain({
      domain,
      confidence,
      scores,
      source,
      columnProfiles,
      fieldMappings,
      confirmedByUser,
    }) {
      const roleProfiles = buildRoleProfiles(domain);
      const existingMappings = this.extractFieldMappings(source.semanticClassification);
      const overrides = { ...existingMappings, ...(fieldMappings || {}) };
      const usedColumns = new Set();
      const criticalFieldStatus = roleProfiles.map((roleProfile) => {
        const rankedCandidates = columnProfiles
          .map((columnProfile) => ({
            columnName: columnProfile.columnName,
            score: scoreCandidate(roleProfile, columnProfile),
          }))
          .sort((left, right) => right.score - left.score);

        const overrideColumn = overrides[roleProfile.role];
        const bestCandidate = overrideColumn
          ? { columnName: overrideColumn, score: 1 }
          : rankedCandidates.find((candidate) => !usedColumns.has(candidate.columnName)) ||
            rankedCandidates[0];
        const resolved =
          Boolean(bestCandidate?.columnName) &&
          (overrideColumn ? true : bestCandidate.score >= 0.7);
        if (resolved && bestCandidate?.columnName) usedColumns.add(bestCandidate.columnName);
        const candidates = rankedCandidates
          .filter((candidate) => candidate.score >= 0.25)
          .slice(0, 4)
          .map((candidate) => candidate.columnName);

        return {
          fieldRole: roleProfile.role,
          resolved,
          mappedColumn: resolved ? bestCandidate.columnName : null,
          candidates: uniq([...(overrideColumn ? [overrideColumn] : []), ...candidates]),
        };
      });

      const mappedFields = criticalFieldStatus.reduce((acc, item) => {
        if (item.resolved && item.mappedColumn) {
          acc[item.fieldRole] = item.mappedColumn;
        }
        return acc;
      }, {});

      return {
        domainId: domain.id,
        domainLabel: domain.label,
        confidence: Number(confidence.toFixed(2)),
        alternativeDomains: scores
          .filter((entry) => entry.domain.id !== domain.id)
          .slice(0, 2)
          .map((entry) => ({
            domainId: entry.domain.id,
            domainLabel: entry.domain.label,
            confidence: Number(entry.score.toFixed(2)),
          })),
        criticalFieldStatus,
        fieldMappings: mappedFields,
        requiresUserInput:
          confidence < this.settings.confidenceThreshold ||
          criticalFieldStatus.some((item) => !item.resolved),
        confirmedByUser,
        resolvedAt: nowIso(),
      };
    },

    extractFieldMappings(classification) {
      if (!classification || typeof classification !== 'object') return {};
      if (classification.fieldMappings && typeof classification.fieldMappings === 'object') {
        return deepClone(classification.fieldMappings);
      }
      return (classification.criticalFieldStatus || []).reduce((acc, item) => {
        if (item?.resolved && item?.mappedColumn) {
          acc[item.fieldRole] = item.mappedColumn;
        }
        return acc;
      }, {});
    },

    async loadSource(ctx, sourceId) {
      const sourceResponse = await ctx.call('datasource-registry.get', { id: sourceId });
      return sourceResponse?.data || sourceResponse;
    },

    async loadRows(ctx, sourceId) {
      const status = await ctx.call('datasource-cache.status', { sourceId }).catch(() => null);
      if (!status?.exists) {
        await ctx.call('datasource-cache.refresh', { sourceId }).catch(() => null);
      }

      const queryResponse = await ctx.call('datasource-cache.query', {
        sourceId,
        limit: this.settings.sampleSize,
        privacyContext: 'internal',
      });

      const rows = Array.isArray(queryResponse?.data)
        ? queryResponse.data
        : Array.isArray(queryResponse?.rows)
          ? queryResponse.rows
          : [];

      return rows;
    },
  },
};
