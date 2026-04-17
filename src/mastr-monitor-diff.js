'use strict';

const MASTR_LABELS = {
  einheitBetriebsstatus: {
    '31': 'In Planung',
    '35': 'In Betrieb',
    '37': 'Vorübergehend stillgelegt',
    '38': 'Dauerhaft stillgelegt',
  },
  netzbetreiberpruefungStatus: {
    2954: 'Geprüft',
    2955: 'In Prüfung',
    3075: 'Nicht vorgesehen',
  },
  'napData.spannungsebene': {
    342: 'Höchstspannung',
    347: 'Hochspannung',
    352: 'Mittelspannung',
    354: 'Niederspannung',
  },
};

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function resolveLabel(field, value) {
  if (value === null || value === undefined || value === '') return null;
  const labels = MASTR_LABELS[field];
  if (!labels) return String(value);
  return labels[value] || labels[String(value)] || String(value);
}

function fieldLabel(field) {
  const labels = {
    einheitBetriebsstatus: 'Betriebsstatus',
    nettonennleistung: 'Nettonennleistung',
    bruttoleistung: 'Bruttoleistung',
    inbetriebnahmedatum: 'Inbetriebnahmedatum',
    fernsteuerbarkeitDv: 'Fernsteuerbarkeit DV',
    netzbetreiberpruefungStatus: 'Netzbetreiberprüfung',
    direktvermarkterMastrNummer: 'Direktvermarkter MaStR-Nummer',
    direktvermarkterName: 'Direktvermarkter Name',
    'napData.spannungsebene': 'Spannungsebene',
    lastUpdatedAt: 'Letzte Aktualisierung',
  };
  return labels[field] || field;
}

function normalizeEntries(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.entries)) return snapshot.entries;
  if (Array.isArray(snapshot?.installations)) return snapshot.installations;
  return [];
}

function toComparable(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function buildSnapshotEntry(installation, watchFields = []) {
  const entry = {
    mastrNummer: installation?.mastrNummer || null,
    name: installation?.name || null,
    ort: installation?.ort || null,
    postleitzahl: installation?.postleitzahl || null,
    lastUpdatedAt: installation?.lastUpdatedAt || installation?.updatedAt || null,
  };

  for (const field of watchFields) {
    entry[field] = getNestedValue(installation, field);
  }

  return entry;
}

function computeDelta(prevSnapshot, currSnapshot, watchFields = []) {
  const prevEntries = normalizeEntries(prevSnapshot);
  const currEntries = normalizeEntries(currSnapshot);

  const prevMap = new Map(
    prevEntries
      .filter((entry) => entry?.mastrNummer)
      .map((entry) => [String(entry.mastrNummer), entry])
  );
  const currMap = new Map(
    currEntries
      .filter((entry) => entry?.mastrNummer)
      .map((entry) => [String(entry.mastrNummer), entry])
  );

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const [mastrNummer, curr] of currMap.entries()) {
    if (!prevMap.has(mastrNummer)) {
      added.push(curr);
    }
  }

  for (const [mastrNummer, prev] of prevMap.entries()) {
    if (!currMap.has(mastrNummer)) {
      const status = String(prev?.einheitBetriebsstatus || '');
      removed.push({
        ...prev,
        removalReason:
          status === '37' || status === '38' ? 'Stilllegung' : 'Nicht mehr im Filter',
      });
    }
  }

  for (const [mastrNummer, curr] of currMap.entries()) {
    if (!prevMap.has(mastrNummer)) continue;
    const prev = prevMap.get(mastrNummer);

    const prevUpdated = prev?.lastUpdatedAt || prev?.updatedAt;
    const currUpdated = curr?.lastUpdatedAt || curr?.updatedAt;
    if (prevUpdated && currUpdated && prevUpdated === currUpdated) {
      unchanged += 1;
      continue;
    }

    const fields = [];
    for (const field of watchFields) {
      const from = getNestedValue(prev, field);
      const to = getNestedValue(curr, field);
      if (toComparable(from) === toComparable(to)) continue;

      fields.push({
        field,
        label: fieldLabel(field),
        from,
        fromLabel: resolveLabel(field, from),
        to,
        toLabel: resolveLabel(field, to),
      });
    }

    if (fields.length > 0) {
      changed.push({
        mastrNummer,
        name: curr?.name || prev?.name || null,
        fields,
        lastUpdatedAt: curr?.lastUpdatedAt || curr?.updatedAt || null,
      });
    } else {
      unchanged += 1;
    }
  }

  const summary = {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    unchanged,
    total: added.length + removed.length + changed.length + unchanged,
  };

  return {
    added,
    removed,
    changed,
    summary,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  MASTR_LABELS,
  getNestedValue,
  resolveLabel,
  buildSnapshotEntry,
  computeDelta,
};
