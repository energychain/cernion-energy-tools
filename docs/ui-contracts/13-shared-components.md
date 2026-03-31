# UI Contract: Shared Components

> **Page ID:** (shared — used across all pages)
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## Overview

This document defines UI components used in multiple pages across the Cernion dashboard.
Frontend teams MUST use these components consistently to ensure uniform UX.

---

## 1. Severity Chip

Used on: finding codes, alerts, agent results.

```
[error]   → red background,   white text
[warning] → yellow background, dark text
[info]    → blue background,   white text
```

CSS classes (reference): `.severity-chip--error`, `.severity-chip--warning`, `.severity-chip--info`

---

## 2. Decision Badge

Used on: Grid Connection, Energy Sharing results.

| Value | Display text | Colour |
|-------|-------------|--------|
| `GO_DIRECT` | ✅ Direkt genehmigt | green |
| `GO_CONDITIONAL` | ⚠ Mit Auflagen | yellow |
| `NO_GO_EXPANSION` | 🚫 Keine Erweiterung | orange |
| `NO_GO_CRITICAL` | ❌ Abgelehnt | red |
| `DATA_QUALITY_INSUFFICIENT` | ℹ️ Datenlage unzureichend | grey |
| `APPROVED` | ✅ Genehmigt | green |
| `APPROVED_WITH_CONDITIONS` | ⚠ Mit Auflagen | yellow |
| `REJECTED` | ❌ Abgelehnt | red |
| `PENDING_DOCUMENTS` | 📋 Dokumente ausstehend | grey |
| `ELIGIBLE` | ✅ Förderfähig (§ 42c) | blue |
| `NOT_ELIGIBLE` | ℹ️ Nicht förderfähig | grey |

---

## 3. KPI Card

Used on: Dashboard overview, VNB Monitor.

- Header: icon + title
- Body: large number + unit
- Footer: secondary stat + timestamp
- Colour coding: see traffic-light thresholds in respective page contracts

---

## 4. Pipeline Step Timeline

Used on: Grid Connection (6 steps), Energy Sharing (6 steps), MaStR Quality (8 steps), Redispatch (7 steps).

```
Step 1 ──●── Step 2 ──●── Step 3 ──●──…
         ✓            ✓            ⚠
         VNB          Capacity     NAP check
```

States:
- `completed` — filled green circle + ✓
- `skipped` — dashed border + "Übersprungen"
- `failed` — red circle + ✗ + expandable error detail
- `running` — spinner
- `pending` — unfilled circle

---

## 5. Findings Table

Used on: All agent audit pages, VNB Monitor.

Columns: Severity chip | Code (monospace, tooltip from finding-codes) | Step | Detail (expandable)
Sort: Default by severity desc (error → warning → info)
Filter: severity checkboxes + text search
Export: "Export CSV" button (browser-side)

---

## 6. Job Progress Indicator

Used on: Any async action (audit, validate, export).

Shown above the results area while polling `GET /api/jobs/:jobId`:

```
⏳ Schritt 4/8 — Kapazitätsprüfung läuft…
██████████░░░░░░░░░░ 50%
```

Progress: approximate (step N / totalSteps × 100%).
On error: red banner with error message + "Wiederholen" button.
On completion: auto-dismiss after 2 seconds.

---

## 7. Partial Data Banner

Shown when `_errors.length > 0` in any dashboard endpoint response.

```
⚠ Teilweise Daten — 2 Dienst(e) nicht erreichbar
[energy-market.prices] [entsoe.windSolarForecast]  ▼ Details
```

Expandable to show full error list. Never blocks the rest of the UI.

---

## 8. Empty State

Used when a list or result set is empty.

```
  [ illustration / icon ]
  Keine Daten vorhanden.
  [optional CTA button]
```

---

## 9. Confirmation Dialog

Used before destructive actions (delete, revoke, reset).

```
Wirklich löschen?
Dieser Vorgang kann nicht rückgängig gemacht werden.

[Abbrechen]  [🗑 Löschen]
```

---

## 10. Toast Notifications

Used after successful or failed actions.

| Type | Icon | Duration |
|------|------|----------|
| Success | ✓ green | 3 seconds |
| Warning | ⚠ yellow | 5 seconds |
| Error | ✗ red | 8 seconds (no auto-dismiss) |
| Info | ℹ blue | 3 seconds |

---

## 11. Async Job Polling Utility

All async endpoints return `{ jobId, pollUrl }`. Standard polling flow:

```javascript
async function pollJob(pollUrl, intervalMs = 2000, timeoutMs = 200000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(pollUrl, { headers: authHeaders });
    const job = await res.json();
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed')    throw new Error(job.error || 'Job failed');
    await sleep(intervalMs);
  }
  throw new Error('Job timed out');
}
```

---

## 12. Authentication Header Utility

All API calls must include auth:

```javascript
function authHeaders() {
  const token = localStorage.getItem('cernion_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}
```

Session storage recommendation: `localStorage` for persistent sessions, `sessionStorage` for
ephemeral tabs. Never embed tokens in URLs in production.

---

## 13. Error Code Reference

All HTTP error responses follow the Moleculer envelope. Map to UI messages:

| HTTP Code | `type` | User message |
|-----------|--------|-------------|
| 400 | `VALIDATION_ERROR` | Inline field errors |
| 401 | `UNAUTHORIZED` | Redirect to token entry |
| 403 | `FORBIDDEN` | "Zugriff verweigert — erforderlicher Scope: full-access" |
| 404 | `NOT_FOUND` | "Nicht gefunden" |
| 422 | `VALIDATION_ERROR` | Inline validation messages |
| 429 | `RATE_LIMIT` | "Zu viele Anfragen — bitte warten" |
| 500 | `INTERNAL_ERROR` | "Interner Fehler — Support kontaktieren" |
| 503 | `SERVICE_UNAVAILABLE` | "Backend nicht erreichbar — Verbindung prüfen" |
