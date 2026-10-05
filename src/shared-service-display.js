'use strict';

// Translate historical journal codes at the output boundary as well as
// new entries, without changing their machine-readable state.
function readableSharedServiceText(value) {
  const phrases = {
    attention_transient: 'Die Aufmerksamkeit ist vorübergehend.',
    attention_established: 'Die Funktion ist dauerhaft etabliert.',
    attention_retained: 'Die Funktion wird ausdrücklich beibehalten.',
    attention_inventory: 'Die Funktion gehört zum Inventar.',
    attention_retired: 'Die Aufmerksamkeit ist verfallen; CET hat die Verantwortung abgegeben.',
    allowance_exhausted: 'Der Arbeitsrahmen ist aufgebraucht; ein neuer Anstoß ist nötig.',
  };
  return String(value || '')
    .replace(
      /\b(?:attention_(?:transient|established|retained|inventory|retired)|allowance_exhausted)\b/g,
      (code) => phrases[code]
    )
    .replace(
      /Push source unavailable; scheduled observation is required\.?/g,
      'Es gibt noch keine Ereignisquelle. CET prüft den Zustand regelmäßig.'
    );
}
module.exports = { readableSharedServiceText };
