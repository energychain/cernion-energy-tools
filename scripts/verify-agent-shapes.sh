#!/usr/bin/env bash
# verify-agent-shapes.sh — v0.20.3 pre-gate shape verification
# Verifies actual response shapes of the four agent endpoints against UI contracts 05-08.
# Usage: bash scripts/verify-agent-shapes.sh
#        CERNION_TOKEN=ck_... bash scripts/verify-agent-shapes.sh

BASE="http://10.0.0.8:3900"
OUT="docs/agent-responses"
mkdir -p "$OUT"

call() {
  local name="$1"; shift
  echo "→ $name"
  local http_code
  http_code=$(curl -s -o "$OUT/$name.json" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    ${CERNION_TOKEN:+-H "Authorization: Bearer $CERNION_TOKEN"} \
    "$@")
  echo "  HTTP $http_code — $(wc -c < "$OUT/$name.json") bytes"
  echo "$http_code" > "$OUT/$name.status"
}

echo "=== Audit/Validate Endpoints ==="

call "mq-audit" -X POST "$BASE/api/mastr-quality/audit" \
  -d '{"gridOperatorId":"SNB935578300972"}'

call "gc-validate" -X POST "$BASE/api/grid-connection/validate" \
  -d '{"gridOperatorId":"SNB935578300972"}'

call "es-validate" -X POST "$BASE/api/energy-sharing/validate" \
  -d '{
    "gridOperatorId":"SNB935578300972",
    "generators":[{"mastrNummer":"SEE988149395570","sharePercent":100}],
    "consumers":[{"maloId":"DE00039767069900000000000000731310","sharePercent":100}]
  }'

call "rd-audit" -X POST "$BASE/api/redispatch/audit" \
  -d '{
    "gridOperatorId":"SNB935578300972",
    "dateFrom":"2026-01-01",
    "dateTo":"2026-03-31"
  }'

echo ""
echo "=== List Endpoints ==="

call "mq-list"  "$BASE/api/mastr-quality/audits?gridOperatorId=SNB935578300972&limit=1"
call "gc-list"  "$BASE/api/grid-connection/validations?gridOperatorId=SNB935578300972&limit=1"
call "es-list"  "$BASE/api/energy-sharing/validations?limit=1"
call "rd-list"  "$BASE/api/redispatch/audits?gridOperatorId=SNB935578300972&limit=1"

echo ""
echo "=== Allocation ==="

call "alloc-list" "$BASE/api/energy-sharing-allocation/allocations?limit=1"

echo ""
echo "=== HTTP-Status-Übersicht ==="
for f in "$OUT"/*.status; do
  printf "  %-35s %s\n" "$(basename "${f%.status}")" "$(cat "$f")"
done
