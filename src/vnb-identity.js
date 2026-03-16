function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function inferIdentityFromRows(rows = []) {
  const idRegex = /^(?:SNB|GNB)[A-Z0-9]{8,}$/i;
  const bdewRegex = /^\d{7,16}$/;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const [key, rawValue] of Object.entries(row)) {
      if (rawValue === null || rawValue === undefined) continue;
      const value = String(rawValue).trim();
      if (!value) continue;
      const keyText = String(key).toLowerCase();

      if (idRegex.test(value) && /mastr|netzbetreiber|vnb|operator/.test(keyText)) {
        return { mastrId: value, name: null, bdewCode: null };
      }
      if (bdewRegex.test(value) && /bdew/.test(keyText)) {
        return { mastrId: null, name: null, bdewCode: value };
      }
      if (/anschlussnetzbetreiber|netzbetreiber|vnb|operator/.test(keyText) && value.length >= 3) {
        return { mastrId: null, name: value, bdewCode: null };
      }
    }
  }

  return null;
}

/**
 * Resolve VNB identity from available sources.
 * Returns { mastrId, name, bdewCode } or null if unresolvable.
 *
 * @param {import('moleculer').ServiceBroker} broker
 * @returns {Promise<{mastrId: string|null, name: string|null, bdewCode: string|null} | null>}
 */
async function resolveVnbIdentity(broker) {
  const envIdentity = {
    mastrId: pickFirst(
      process.env.CERNION_VNB_MASTR_ID,
      process.env.CERNION_VNB_ID,
      process.env.VNB_ID
    ),
    name: pickFirst(process.env.CERNION_VNB_NAME, process.env.VNB_NAME),
    bdewCode: pickFirst(process.env.CERNION_VNB_BDEW, process.env.VNB_BDEW),
  };

  if (envIdentity.mastrId || envIdentity.name || envIdentity.bdewCode) {
    return envIdentity;
  }

  if (!broker || typeof broker.call !== 'function') return null;

  try {
    const listResponse = await broker.call('datasource-registry.list', {});
    const sources = Array.isArray(listResponse?.data)
      ? listResponse.data
      : Array.isArray(listResponse)
        ? listResponse
        : [];

    const ranked = [...sources]
      .sort((left, right) => {
        const leftTs =
          Date.parse(left?.semanticClassification?.updatedAt || left?.updatedAt || 0) || 0;
        const rightTs =
          Date.parse(right?.semanticClassification?.updatedAt || right?.updatedAt || 0) || 0;
        return rightTs - leftTs;
      })
      .filter(Boolean);

    for (const source of ranked) {
      const classification = source.semanticClassification || {};
      const mappings = classification.fieldMappings || {};
      const mastrId = pickFirst(
        source?.semanticHints?.vnbMastrId,
        source?.connectorConfig?.vnbMastrId,
        source?.metadata?.vnbMastrId
      );
      const name = pickFirst(
        source?.semanticHints?.vnbName,
        source?.connectorConfig?.vnbName,
        source?.metadata?.vnbName,
        source?.connectorConfig?.Anschlussnetzbetreiber
      );
      const bdewCode = pickFirst(
        source?.semanticHints?.vnbBdew,
        source?.connectorConfig?.vnbBdew,
        source?.metadata?.vnbBdew
      );

      if (mastrId || name || bdewCode) {
        return { mastrId: mastrId || null, name: name || null, bdewCode: bdewCode || null };
      }

      const rowField =
        mappings.anschlussnetzbetreiber ||
        mappings.vnbName ||
        mappings.gridOperatorName ||
        mappings.gridOperatorId;

      if (rowField) {
        const query = await broker.call('datasource-cache.query', {
          sourceId: source.id || source.sourceId,
          limit: 10,
          privacyContext: 'internal',
        });
        const rows = Array.isArray(query?.data) ? query.data : [];
        const inferred = inferIdentityFromRows(
          rows.map((row) => ({ [rowField]: row?.[rowField], ...row }))
        );
        if (inferred) return inferred;
      }
    }
  } catch {
    // Fall through to unresolved
  }

  return null;
}

module.exports = {
  resolveVnbIdentity,
};
