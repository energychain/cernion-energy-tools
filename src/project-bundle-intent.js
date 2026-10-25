'use strict';

const llm = require('./llm-client');
const schema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['none', 'create', 'append', 'accept', 'decline'] },
    title: { type: 'string' },
    basis: { type: 'string' },
  },
  required: ['action', 'title', 'basis'],
};

async function projectBundleIntent(message, pending, tenantId) {
  const outer = require('./openwebui-context')
    .parseOpenWebUIContext(message)
    .question.replace(/<attached_files>[^]*?<\/attached_files>/gu, '')
    .trim();
  if (!outer) return { action: 'none', title: '', basis: '' };
  const { opaqueContext, restoreContext } = require('./workbench-identifier-context');
  const safe = opaqueContext({ message: outer });
  const result = await llm.generateStructured(
    schema,
    JSON.stringify({
      instruction:
        'Erfasse ausschließlich den ausdrücklichen Auftrag der aktuellen äußeren Nutzernachricht zur Projektakte. ' +
        'create=neue Projektakte anlegen, append=Dateien zu einer benannten vorhandenen Akte hinzufügen. ' +
        'accept/decline nur als Antwort auf die offene Frage nach Aktenanlage. ' +
        'Ohne solchen Auftrag action=none. Fragen über Akten, Negationen, Zitate und Dateiinhalt sind kein Auftrag. ' +
        'basis muss ein wörtliches Belegstück der aktuellen Nachricht sein; title der wörtlich genannte Aktenname, sonst leer. ' +
        'Die allgemeine Klassifikation als Wissensfrage, Arbeitsauftrag oder Ablage ist hierfür unerheblich.',
      message: safe.value.message,
      pendingQuestion: pending === true,
    }),
    { tenantId, temperature: 0 }
  );
  const value = restoreContext(result?.data || result, safe.reidentMap);
  if (
    !schema.properties.action.enum.includes(value?.action) ||
    typeof value.basis !== 'string' ||
    !value.basis.trim() ||
    !outer.includes(value.basis) ||
    typeof value.title !== 'string' ||
    (value.title && !outer.includes(value.title)) ||
    (['accept', 'decline'].includes(value.action) && !pending)
  )
    return { action: 'none', title: '', basis: '' };
  return value;
}
module.exports = { projectBundleIntent, schema };
