#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CERNION_BASE_URL:-}" || -z "${CERNION_RUNDECK_TOKEN:-}" ]]; then
  echo "CERNION_BASE_URL and CERNION_RUNDECK_TOKEN are required" >&2
  exit 2
fi

method="${1:-}"
path="${2:-}"
payload="${3:-}"

if [[ -z "$method" || -z "$path" ]]; then
  echo "Usage: cernion-runbook-call.sh METHOD /api/operations-runbook/... [json-payload]" >&2
  exit 2
fi

if [[ -z "$payload" ]]; then
  payload='{}'
fi

tmp="$(mktemp)"
curl_args=(
  -sS
  -o "$tmp"
  -w '%{http_code}'
  -X "$method"
  -H "Authorization: Bearer ${CERNION_RUNDECK_TOKEN}"
  -H 'Content-Type: application/json'
)
if [[ "${method^^}" != "GET" && "${method^^}" != "HEAD" ]]; then
  curl_args+=(--data "$payload")
fi

status="$(
  curl "${curl_args[@]}" "${CERNION_BASE_URL%/}${path}"
)"

if command -v node >/dev/null 2>&1; then
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
elif command -v perl >/dev/null 2>&1; then
  perl -0777 - "$tmp" <<'PERL'
use strict;
use warnings;
my $file = $ARGV[0];
open my $fh, '<', $file or die "Cannot read $file: $!";
my $raw = do { local $/; <$fh> };
if ($raw =~ /"summary"\s*:\s*\{.*?"markdown"\s*:\s*"((?:\\.|[^"\\])*)"/s) {
  my $markdown = $1;
  $markdown =~ s/\\n/\n/g;
  $markdown =~ s/\\"/"/g;
  $markdown =~ s/\\\\/\\/g;
  print $markdown, "\n";
}
print "\n--- JSON RESULT ---\n";
print $raw, "\n";
PERL
else
  echo "node or perl is required to render the runbook response" >&2
  cat "$tmp"
  exit 2
fi

if [[ "$status" -ge 400 ]]; then
  exit 1
fi
