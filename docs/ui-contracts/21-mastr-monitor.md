# UI-Contract 21 — MaStR Monitoring

Version: 0.38.1
Service: `mastr-monitor`
Base path: `/api/mastr-monitor`

## Endpoints (12)

1. `POST /watches` — createWatch
2. `GET /watches` — listWatches
3. `GET /watches/:watchId` — getWatch
4. `DELETE /watches/:watchId` — deleteWatch
5. `POST /watches/:watchId/run` — runWatch
6. `GET /watches/:watchId/deltas` — getDeltas
7. `GET /watches/:watchId/deltas/:deltaId` — getDelta
8. `GET /watches/:watchId/snapshot?format=json|csv` — getSnapshot
9. `POST /watches/:watchId/subscribe` — subscribe
10. `DELETE /watches/:watchId/subscribe/:token` — unsubscribe
11. `GET /confirm/:token` — confirmSubscription
12. `POST /from-session` — createFromSession

## Delta shape

```json
{
  "watchId": "...",
  "deltaId": "YYYY-MM-DD",
  "timestamp": "ISO-8601",
  "baseline": "ISO-8601|null",
  "summary": { "added": 0, "removed": 0, "changed": 0, "unchanged": 0, "total": 0 },
  "added": [],
  "removed": [],
  "changed": [
    {
      "mastrNummer": "SEE...",
      "fields": [
        {
          "field": "netzbetreiberpruefungStatus",
          "label": "Netzbetreiberprüfung",
          "from": 2955,
          "fromLabel": "In Prüfung",
          "to": 2954,
          "toLabel": "Geprüft"
        }
      ]
    }
  ]
}
```

## Scheduling

Presets:
- `daily_morning` → `0 6 * * *`
- `weekday_morning` → `0 6 * * 1-5`
- `weekly_monday` → `0 6 * * 1`
- `monthly_first` → `0 6 1 * *`

Custom cron is supported via `schedule: { type: "cron", expression, timezone }` **with a minimum interval of daily**.

- Allowed: one execution time per day (or less frequent), e.g. `0 6 * * *`, `30 7 * * 1`, `0 6 1 * *`
- Rejected: high-frequency schedules (e.g. `*/5 * * * *`, `0 */2 * * *`)
- Error contract: `422 INVALID_SCHEDULE`

## Subscription flow

- Subscribe creates a pending subscription (`pending_confirmation`) with token.
- Confirmation link (`GET /confirm/:token`) activates subscription (`confirmed`).
- Unsubscribe is token-based (`DELETE /watches/:watchId/subscribe/:token`).

Path parameter `:token` is treated as a **business token** for confirm/unsubscribe routes (not stripped as auth token by gateway preprocessing).

## Token-link architecture

No account is required. Access is managed via opaque tokens/hash pairs:
- watch token for manage links
- subscription token for confirm/unsubscribe links

## Email templates (reference)

- Confirmation email (Double-Opt-In)
- Delta email (added/removed/changed summary + links)
  - Detail lists are capped (default: 100 entries per section)
  - Summary counters always reflect the full delta
- Optional no-change digest (when `onlyOnChanges=false`)

## Scalability semantics (v0.27.3)

- Default per-run processing limit increased to `50,000` installations
  (`MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH`).
- Snapshot and delta payloads may be persisted as chunked manifests internally.
  API responses (`getSnapshot`, `getDelta`, `getDeltas`) remain hydrated and backward compatible.
- Internal chunking can be controlled via:
  - `MASTR_MONITOR_CHUNKING_ENABLED=true|false`
  - `MASTR_MONITOR_CHUNK_SIZE` (default `1000`)

## Live-CSV integration

`POST /from-session` resolves a session, extracts filter params, removes paging/output params (`format`, `limit`, `offset`) and creates a watch.

## Frontend hints

- Use `GET /watches?email=...` to show “Meine Monitorings”.
- Show latest summary from `watch.lastDelta`.
- For details, call `GET /watches/:watchId/deltas` and open newest delta.
- For CSV export, use `GET /watches/:watchId/snapshot?format=csv`.

---

## Änderungen seit letzter Version

### v0.27.3 — Chunked Persistence für große Snapshots/Deltas

Snapshots und Delta-Details werden intern in Chunks von 1.000 Einträgen in der
PouchDB gespeichert um Dokument-Größenlimits zu vermeiden. Die API-Responses
(`getSnapshot`, `getDelta`, `getDeltas`) sind hydratisiert und rückwärtskompatibel.

Neue Umgebungsvariablen (optional):
- `MASTR_MONITOR_CHUNKING_ENABLED` — Chunking aktivieren/deaktivieren (default: `true`)
- `MASTR_MONITOR_CHUNK_SIZE` — Chunk-Größe (default: `1000`)
- `MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH` — Limit pro Watch-Lauf (default: `50000`, war: `5000`)
- `MASTR_MONITOR_EMAIL_DETAIL_LIMIT` — Max. Einträge in Detail-Listen in E-Mails (default: `100`)

**Pagination-Hinweis für große Portfolios:**
Bei VNBs mit >50.000 Installationen werden Watch-Läufe automatisch auf
`MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH` begrenzt. Das UI sollte
`watch.lastDelta.summary.limitApplied: true` prüfen und ggf. einen
Info-Banner zeigen: „Portfolio-Limit erreicht — nicht alle Anlagen geprüft".

### v0.38.0 — Keine Änderungen am MaStR-Monitor-Contract

Der MaStR-Monitor-Service wurde in v0.28\u2013v0.38 nicht geändert.
