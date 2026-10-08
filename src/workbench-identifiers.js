'use strict';

const { isSensitiveField } = require('./prompt-scrubber');
const identifierKinds = require('./workbench-identifier-kinds.json');
const { types } = require('./workbench-code-catalog.json');

function completeReference(text, value) {
  if (!value || !String(value).trim()) return false;
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // Punctuation inside references is part of the reference: PSUTI must not match
  // PSUTI-123/456 and a numeric suffix must not match a larger identifier.
  return new RegExp(
    String.raw`(?:^|[^\p{L}\p{N}_@./-])${escaped}(?=$|[^\p{L}\p{N}_@./-]|\.(?:\s|$))`,
    'u'
  ).test(String(text));
}
function displayIdentifier(entry) {
  const kind = String(entry?.kind || '').trim();
  const value = String(entry?.value || '').trim();
  if (!kind || !value || isSensitiveField(kind) || /@|\n|\[Angabe\]|MASKED/iu.test(value))
    return false;
  const normalizedKind = kind.toLocaleLowerCase().replace(/[_\s-]/gu, '');
  if (identifierKinds.nonReferenceKinds.includes(normalizedKind)) return false;
  // Untyped short numeric snippets cannot establish a reference.
  if (identifierKinds.genericKinds.includes(normalizedKind) && /^\d{1,5}$/u.test(value))
    return false;
  return true;
}
function validatedIdentifiers(entries, facts, previous = []) {
  return (entries || []).filter((entry) => {
    if (!displayIdentifier(entry) || !completeReference(facts, entry.value)) return false;
    const type = types.find((item) => item.kind === entry.kind);
    if (!type || previous.some((known) => known.kind === entry.kind && known.value === entry.value))
      return true;
    return [...String(facts).matchAll(new RegExp(type.pattern, 'g'))].some(
      (match) => match[1] === entry.value
    );
  });
}
module.exports = { completeReference, displayIdentifier, validatedIdentifiers };
