'use strict';

/** Operator-supplied base URL; remote UAT traffic must use TLS. */
function uatBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('Set UAT_API_BASE_URL to an explicit HTTP(S) origin.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'UAT_API_BASE_URL requires HTTPS (HTTP only on loopback), without credentials or a path.'
    );
  }
  return url.origin;
}

/** Job IDs are opaque path segments, never URLs or relative paths. */
function jobPath(jobId, view) {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(jobId)) {
    throw new Error('Server returned an invalid job ID.');
  }
  if (!['status', 'result'].includes(view)) throw new Error('Invalid job view.');
  return `/api/jobs/${encodeURIComponent(jobId)}/${view}`;
}

function logData(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 12 || seen.has(value)) return '[Unserializable]';
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((entry) => logData(entry, seen, depth + 1));
  else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /password|secret|token|authorization|cookie|api[-_]?key/i.test(key)
          ? '[REDACTED]'
          : logData(entry, seen, depth + 1),
      ])
    );
  }
  seen.delete(value);
  return result;
}

/** JSON encodes CR/LF and terminal control characters in untrusted responses. */
function logRecord(event, data) {
  return JSON.stringify({ event, data: logData(data) });
}

module.exports = { uatBaseUrl, jobPath, logRecord };
