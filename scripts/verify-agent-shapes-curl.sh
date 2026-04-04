#!/usr/bin/env bash
# scripts/verify-agent-shapes-curl.sh
#
# Live response-shape capture against a running server.
# Saves JSON responses to docs/agent-responses/ and runs jq spot-checks
# for the highest-risk shape questions identified in ui-contract-verification.md.
#
# Usage:
#   bash scripts/verify-agent-shapes-curl.sh
#   API_BASE=http://localhost:3900 bash scripts/verify-agent-shapes-curl.sh
#
# Requires: curl, jq (for spot-checks — skipped gracefully if absent)
# Server must be running with at least one previous audit stored (for list endpoints).

set -euo pipefail

API_BASE="${API_BASE:-http://10.0.0.8:3900}"
OUT_DIR="docs/agent-responses"
GRID_OP="SNB935578300972"
DATE_FROM="2026-01-01"
DATE_TO="2026-03-31"

mkdir -p "$OUT_DIR"

echo "═══════════════════════════════════════════"
echo "  Agent Shape Verification (curl)"
echo "  API: $API_BASE"
echo "  Output: $OUT_DIR/"
echo "═══════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# Helper: POST with JSON body
# ---------------------------------------------------------------------------
post_json() {
  local label="$1"
  local path="$2"
  local body="$3"
  local file="$OUT_DIR/${label}.json"

  echo -n "  POST $path … "
  local http_code
  http_code=$(curl -s -o "$file" -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$body" \
    "$API_BASE$path")
  echo "HTTP $http_code → $file"

  # If 202 (async), follow jobId
  if [[ "$http_code" == "202" ]]; then
    local job_id
    job_id=$(jq -r '.jobId // empty' "$file" 2>/dev/null || echo "")
    if [[ -n "$job_id" ]]; then
      echo -n "    Polling $job_id "
      local poll_file="${OUT_DIR}/${label}-result.json"
      local attempts=0
      while [[ $attempts -lt 60 ]]; do
        sleep 3
        local poll_code
        poll_code=$(curl -s -o "$poll_file" -w "%{http_code}" \
          -H "Accept: application/json" \
          "$API_BASE/api/jobs/$job_id")
        local status
        status=$(jq -r '.status // empty' "$poll_file" 2>/dev/null || echo "")
        echo -n "."
        if [[ "$status" == "completed" || "$status" == "failed" ]]; then
          echo " $status"
          # Extract result payload into the main label file
          jq '.result // .' "$poll_file" > "$file" 2>/dev/null || true
          break
        fi
        attempts=$((attempts + 1))
      done
      if [[ $attempts -ge 60 ]]; then
        echo " timeout"
      fi
    fi
  fi
}

# ---------------------------------------------------------------------------
# Helper: GET
# ---------------------------------------------------------------------------
get_json() {
  local label="$1"
  local path="$2"
  local file="$OUT_DIR/${label}.json"

  echo -n "  GET  $path … "
  local http_code
  http_code=$(curl -s -o "$file" -w "%{http_code}" \
    -H "Accept: application/json" \
    "$API_BASE$path")
  echo "HTTP $http_code → $file"
}

# ---------------------------------------------------------------------------
# Audit / validate endpoints
# ---------------------------------------------------------------------------

post_json "mastr-quality-audit" "/api/mastr-quality/audit" \
  "{\"gridOperatorId\":\"$GRID_OP\",\"skipSteps\":[4,5,6,7]}"

post_json "grid-connection-validate" "/api/grid-connection/validate" \
  "{\"gridOperatorId\":\"$GRID_OP\"}"

post_json "energy-sharing-validate" "/api/energy-sharing/validate" \
  "{\"gridOperatorId\":\"$GRID_OP\",\
\"generators\":[{\"mastrNummer\":\"SEE988149395570\",\"sharePercent\":100}],\
\"consumers\":[{\"maloId\":\"DE0003976706990000000000000073131\",\"sharePercent\":100,\"name\":\"Verify\"}]}"

# NOTE: redispatch uses dateFrom/dateTo (not periodFrom/periodTo — see ui-contract-verification.md)
post_json "redispatch-audit" "/api/redispatch/audit" \
  "{\"gridOperatorId\":\"$GRID_OP\",\"dateFrom\":\"$DATE_FROM\",\"dateTo\":\"$DATE_TO\",\"skipSteps\":[4,5,6]}"

# ---------------------------------------------------------------------------
# List endpoints
# ---------------------------------------------------------------------------

get_json "mastr-quality-list"     "/api/mastr-quality/list?gridOperatorId=$GRID_OP&limit=1"
get_json "grid-connection-list"   "/api/grid-connection/list?gridOperatorId=$GRID_OP&limit=1"
get_json "energy-sharing-list"    "/api/energy-sharing/list?limit=1"
get_json "redispatch-list"        "/api/redispatch/list?gridOperatorId=$GRID_OP&limit=1"

# ---------------------------------------------------------------------------
# jq spot-checks against known discrepancies
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo ""
  echo "  (jq not found — skipping spot-checks)"
  echo "  Install with: apt install jq  or  brew install jq"
  echo ""
  exit 0
fi

echo ""
echo "─── jq spot-checks (known discrepancies) ─────────────────────────────"
echo ""

check() {
  local label="$1"
  local file="$2"
  local query="$3"
  local expected="$4"
  local description="$5"

  if [[ ! -f "$file" ]]; then
    echo "  ⚠  SKIP  $label — file not found"
    return
  fi

  local actual
  actual=$(jq -r "$query" "$file" 2>/dev/null || echo "PARSE_ERROR")

  if [[ "$actual" == "$expected" ]]; then
    echo "  ✅  $label: $description → \"$actual\""
  else
    echo "  ❌  $label: $description"
    echo "       Expected: \"$expected\""
    echo "       Actual:   \"$actual\""
  fi
}

# mastr-quality: dimension container key
check "MQ dimensions key" \
  "$OUT_DIR/mastr-quality-audit.json" \
  'if .qualityDimensions then "qualityDimensions" elif .dimensions then "dimensions" else "missing" end' \
  "qualityDimensions" \
  "Top-level dimension key is qualityDimensions"

# mastr-quality: actual dimension keys
check "MQ dimension names" \
  "$OUT_DIR/mastr-quality-audit.json" \
  '.qualityDimensions | keys | sort | join(",")' \
  "capacity,connectionPoints,duplicates,geo,status" \
  "Dimension keys: connectionPoints,capacity,geo,status,duplicates"

# mastr-quality: findings field name
check "MQ findings field" \
  "$OUT_DIR/mastr-quality-audit.json" \
  '.findings[0] | if .finding then "finding" elif .code then "code" else "missing" end' \
  "finding" \
  "findings[0] uses key 'finding' not 'code'"

# mastr-quality: findingsCount location
check "MQ findingsCount location" \
  "$OUT_DIR/mastr-quality-audit.json" \
  'if .findingsCount then "top-level" elif .summary.findingsCount then "summary.findingsCount" else "missing" end' \
  "summary.findingsCount" \
  "findingsCount is nested in summary"

# grid-connection: findings reason vs detail
check "GC findings reason field" \
  "$OUT_DIR/grid-connection-validate.json" \
  '.findings[0] | if .reason then "reason" elif .detail then "detail" else "missing" end' \
  "reason" \
  "findings[0] uses key 'reason' not 'detail'"

# grid-connection: steps step vs id
check "GC steps.step field" \
  "$OUT_DIR/grid-connection-validate.json" \
  '.steps[0] | if .step then "step" elif .id then "id" else "missing" end' \
  "step" \
  "steps[0] uses key 'step' not 'id'"

# energy-sharing: generators vs generatorResults
check "ES generators key" \
  "$OUT_DIR/energy-sharing-validate.json" \
  'if .generators then "generators" elif .generatorResults then "generatorResults" else "missing" end' \
  "generators" \
  "enriched generator array key is 'generators' not 'generatorResults'"

# energy-sharing: mastrNummer vs mastrId in generators
check "ES generators[0] mastrNummer" \
  "$OUT_DIR/energy-sharing-validate.json" \
  '.generators[0] | if .mastrNummer then "mastrNummer" elif .mastrId then "mastrId" else "missing" end' \
  "mastrNummer" \
  "generators[0] field is 'mastrNummer' not 'mastrId'"

# redispatch: period fields
check "RD period.dateFrom" \
  "$OUT_DIR/redispatch-audit.json" \
  '.period | if .dateFrom then "dateFrom" elif .from then "from" else "missing" end' \
  "dateFrom" \
  "period uses dateFrom/dateTo not from/to"

# redispatch: riskLevel vs level
check "RD riskLevel field" \
  "$OUT_DIR/redispatch-audit.json" \
  '.riskAssessment | if .riskLevel then "riskLevel" elif .level then "level" else "missing" end' \
  "riskLevel" \
  "riskAssessment uses riskLevel not level"

# redispatch: estimatedLostCompensationEur
check "RD estimatedLostCompensationEur" \
  "$OUT_DIR/redispatch-audit.json" \
  '.riskAssessment | if .estimatedLostCompensationEur then "estimatedLostCompensationEur" elif .estimatedExposureEur then "estimatedExposureEur" else "missing" end' \
  "estimatedLostCompensationEur" \
  "riskAssessment uses estimatedLostCompensationEur"

# redispatch: curtailment top-level vs in findings
check "RD no top-level curtailment" \
  "$OUT_DIR/redispatch-audit.json" \
  'if .curtailment then "top-level" else "not-top-level" end' \
  "not-top-level" \
  "curtailment is not a top-level key (only in findings context)"

# list: count vs total
check "MQ list count key" \
  "$OUT_DIR/mastr-quality-list.json" \
  'if .count then "count" elif .total then "total" else "missing" end' \
  "count" \
  "list returns 'count' not 'total'"

check "RD list settlementReadiness nested" \
  "$OUT_DIR/redispatch-list.json" \
  '.audits[0] | if .settlementReadiness.readinessPercent then "nested" elif .settlementReadinessPercent then "flat" else "missing" end' \
  "nested" \
  "settlementReadiness is a nested object, not a flat field"

echo ""
echo "═══════════════════════════════════════════"
echo "  Done. Raw responses in $OUT_DIR/"
echo "  Static analysis report: docs/ui-contract-verification.md"
echo "  (run: node scripts/verify-agent-shapes.js  to regenerate report)"
echo "═══════════════════════════════════════════"
echo ""
