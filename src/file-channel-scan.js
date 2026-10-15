'use strict';

const { fileError, fileSetting } = require('./file-channel-policy');

async function scanOriginal(ctx, payload, scanner, stream) {
  if (!scanner) return;
  let verdict;
  try {
    verdict = await ctx.call(scanner, payload, {
      timeout: fileSetting('SCAN_TIMEOUT_MS', 30000),
      ...(stream ? { stream } : {}),
    });
  } catch (_error) {
    fileError('Virenscan nicht verfügbar. Datei nicht gespeichert.', 503, 'FILE_SCAN_UNAVAILABLE');
  } finally {
    stream?.destroy();
  }
  if (verdict?.clean !== true)
    fileError('Virenscan hat die Datei abgewiesen.', 422, 'FILE_SCAN_REJECTED');
}

module.exports = { scanOriginal };
