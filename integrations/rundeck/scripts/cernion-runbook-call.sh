#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CERNION_BASE_URL:-}" || -z "${CERNION_RUNDECK_TOKEN:-}" ]]; then
  echo "CERNION_BASE_URL and CERNION_RUNDECK_TOKEN are required" >&2
  exit 2
fi

method="${1:-}"
path="${2:-}"
payload="${3:-{}}"

if [[ -z "$method" || -z "$path" ]]; then
  echo "Usage: cernion-runbook-call.sh METHOD /api/operations-runbook/... [json-payload]" >&2
  exit 2
fi

tmp="$(mktemp)"
status="$(
  curl -sS -o "$tmp" -w '%{http_code}' \
    -X "$method" \
    -H "Authorization: Bearer ${CERNION_RUNDECK_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    "${CERNION_BASE_URL%/}${path}"
)"

node - "$tmp" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data?.summary?.markdown) {
  console.log(data.summary.markdown);
}
console.log('\n--- JSON RESULT ---');
console.log(JSON.stringify(data, null, 2));
NODE

if [[ "$status" -ge 500 ]]; then
  exit 1
fi
