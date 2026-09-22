'use strict';

const PROMINENCE_ORDER = Object.freeze({
  frist_ueberschritten: 100,
  frist_naht: 90,
  freigabe_angefordert: 80,
  blockiert_entscheidungsreife: 70,
  uebergabe_an_mich: 60,
  mir_zugewiesen: 55,
  befund_neu: 50,
  neu_eingegangen: 40,
  uebernahme_ruht: 30,
  in_bearbeitung_durch_andere: 20,
});

function contributionKind(item) {
  return (
    item?.interactionProjection?.naechsterBeitrag?.kind || item?.naechsterBeitrag?.kind || 'keiner'
  );
}

function resolveProminence(item = {}) {
  const reason = item.aufmerksamkeitsgrund || item.attentionReason || 'unbekannt';
  const weight = PROMINENCE_ORDER[reason] || 0;
  const fristkritisch = reason === 'frist_ueberschritten' || reason === 'frist_naht';
  return {
    reason,
    contributionKind: contributionKind(item),
    weight,
    fristkritisch,
    prominence: weight >= 90 ? 'hoch' : weight >= 60 ? 'normal' : 'niedrig',
  };
}

function sortAttentionItems(items = []) {
  return [...items].sort((left, right) => {
    const leftProminence = resolveProminence(left);
    const rightProminence = resolveProminence(right);
    if (rightProminence.weight !== leftProminence.weight) {
      return rightProminence.weight - leftProminence.weight;
    }
    return String(left.caseId || '').localeCompare(String(right.caseId || ''));
  });
}

function canCollapseCriterion(criterion = {}) {
  return criterion.state === 'nicht_anwendbar';
}

function bundleKeyFor(item) {
  return `${resolveProminence(item).reason}::${contributionKind(item)}`;
}

function groupAttentionItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = bundleKeyFor(item);
    if (!groups.has(key)) {
      groups.set(key, {
        bundleKey: key,
        aufmerksamkeitsgrund: resolveProminence(item).reason,
        contributionKind: contributionKind(item),
        count: 0,
        items: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.items.push(item);
  }
  return sortAttentionItems(
    [...groups.values()].map((group) => ({ ...group, caseId: group.bundleKey }))
  );
}

function explainBundle(group = {}) {
  return `Bündelung von ${group.count || 0} Vorgängen mit identischem Aufmerksamkeitsgrund ${group.aufmerksamkeitsgrund || 'unbekannt'} und identischem Beitragstyp ${group.contributionKind || 'keiner'}.`;
}

module.exports = {
  canCollapseCriterion,
  explainBundle,
  groupAttentionItems,
  resolveProminence,
  sortAttentionItems,
};
