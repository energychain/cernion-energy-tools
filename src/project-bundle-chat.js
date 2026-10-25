'use strict';

function bundleSummary(project, objects, manifest) {
  const lines = [
    `Projektakte „${project.title}“: ${objects.filter((o) => o.status === 'received').length} Originale aufgenommen.`,
  ];
  if (manifest?.summary?.text) lines.push(manifest.summary.text);
  if (manifest?.questionTypes?.length)
    lines.push(
      'Jetzt beantwortbar: ' + manifest.questionTypes.map((q) => q.description).join('; ') + '.'
    );
  else lines.push('Beantwortbare Fragen werden nach Abschluss des Manifests angezeigt.');
  const failed = objects.filter(
    (o) =>
      o.status === 'failed' ||
      ['failed', 'unsupported'].includes(o.extraction?.status) ||
      (o.derivation?.type === 'unknown' && !/\.zip$/i.test(o.name))
  );
  if (failed.length)
    lines.push(
      'Nicht verarbeitet: ' +
        failed.map((o) => o.name).join(', ') +
        '. Abgewiesene Dateien oder Archive prüfen; bereits verarbeitete Objekte bleiben erhalten.'
    );
  const pending = objects.filter(
    (o) => o.status === 'receiving' || ['queued', 'processing'].includes(o.ingestState)
  );
  if (pending.length)
    lines.push(
      'Noch in Bearbeitung: ' +
        pending.map((o) => o.name).join(', ') +
        '. Erneutes Senden setzt den Upload fort.'
    );
  lines.push(
    'Akte, Manifest und zugehörige Skills sind über die vorhandenen Werkzeuge erreichbar.'
  );
  return lines.join('\n\n');
}

async function projectBundleCompletion(ctx, model) {
  const ref = ctx.params.cet_project_bundle;
  if (!ref) return null;
  const result = await ctx.call('project-bundle.result', ref);
  return {
    id: `chatcmpl_${require('node:crypto').randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: result.reply }, finish_reason: 'stop' },
    ],
    metadata: { projectBundle: result },
  };
}
module.exports = { bundleSummary, projectBundleCompletion };
