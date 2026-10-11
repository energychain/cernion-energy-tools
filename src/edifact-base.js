'use strict';

// Keep release pairs intact until the leaf component is decoded. Removing them
// during segment splitting turns escaped +/: into structural delimiters.
function splitEscaped(input, delimiter, releaseChar) {
  const parts = [];
  let current = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === releaseChar && index + 1 < input.length) {
      current += char + input[++index];
    } else if (char === delimiter) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

function parseUnaAndBody(raw) {
  const separators = { element: '+', component: ':', decimal: '.', segment: "'", release: '?' };
  let body = raw.trim().replace(/^\uFEFF/u, '');
  if (body.startsWith('UNA') && body.length >= 9) {
    separators.component = body[3];
    separators.element = body[4];
    separators.decimal = body[5];
    separators.release = body[6];
    separators.segment = body[8];
    body = body.slice(9);
  }
  return { separators, body };
}

function splitSegments(body, segmentDelimiter, releaseChar) {
  return splitEscaped(body, segmentDelimiter, releaseChar)
    .map((part) => part.trim())
    .filter(Boolean);
}

function decodeComponent(value, release) {
  let decoded = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === release && i + 1 < value.length) i++;
    decoded += value[i];
  }
  return decoded;
}

function tokenizeSegments(edifactString) {
  if (typeof edifactString !== 'string' || !edifactString.trim())
    throw new Error('EDIFACT input is empty');
  const { separators, body } = parseUnaAndBody(edifactString);
  return splitSegments(body, separators.segment, separators.release).map((text) => {
    const fields = splitEscaped(text, separators.element, separators.release);
    return {
      tag: fields.shift().trim(),
      elements: fields.map((field) =>
        splitEscaped(field, separators.component, separators.release).map((value) =>
          decodeComponent(value, separators.release)
        )
      ),
    };
  });
}

module.exports = { tokenizeSegments, splitEscaped, splitSegments, parseUnaAndBody };
