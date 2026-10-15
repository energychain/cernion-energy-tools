'use strict';

const { fileError } = require('./file-channel-policy');

// Shared by the bounded Office reader and the streaming project archive reader.
function assertArchiveEntry({ name, flags, method }, { office = false, depth = 32 } = {}) {
  const parts = name.split('/');
  if (
    !name ||
    name.length > 4096 ||
    flags & (1 | 64) ||
    ![0, 8].includes(method) ||
    /(^\/|\\|^[a-z]:|[\x00-\x1f\x7f])/i.test(name) ||
    parts.some((part) => part === '..' || part === '.') ||
    parts.length > depth ||
    (office && /vbaProject|embeddings\//i.test(name))
  )
    fileError('Unsicheres Archiv.');
}

module.exports = { assertArchiveEntry };
