# CR: MaStR Monitoring — Änderungserkennung mit Email-Benachrichtigung

## Executive Summary

VNB, Projektierer, Gemeinden und Stadtwerke ziehen heute statische Listen
aus dem MaStR. Interne Prozesse benötigen aber **Bewegungsdaten** — Trigger
wenn sich etwas ändert. MaStR Monitoring baut auf den bestehenden Live-CSV
Sessions auf und ergänzt sie um:

1. **Watches** — gespeicherte Queries mit Benachrichtigungs-Konfiguration
2. **Snapshots** — periodische Zustandsbilder der Query-Ergebnisse
3. **Deltas** — Feld-Level-Änderungserkennung zwischen Snapshots
4. **Notifications** — Email-Benachrichtigung bei Änderungen

Kein Account nötig. Email-basierte Subscription mit Token-Link für
Self-Service. DSGVO-konform via Double-Opt-In.

---

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    mastr-monitor.service.js                  │
│                                                             │
│  Actions:                                                   │
│  ├── createWatch      POST /api/mastr-monitor/watches       │
│  ├── listWatches      GET  /api/mastr-monitor/watches       │
│  ├── getWatch         GET  /api/mastr-monitor/watches/:id   │
│  ├── deleteWatch      DELETE /api/mastr-monitor/watches/:id │
│  ├── runWatch         POST /api/mastr-monitor/watches/:id/run│
│  ├── getDeltas        GET  /api/mastr-monitor/watches/:id/deltas│
│  ├── getDelta         GET  /api/mastr-monitor/watches/:id/deltas/:did│
│  ├── getSnapshot      GET  /api/mastr-monitor/watches/:id/snapshot│
│  ├── subscribe        POST /api/mastr-monitor/watches/:id/subscribe│
│  ├── unsubscribe      DELETE /api/mastr-monitor/watches/:id/subscribe/:token│
│  ├── confirmSubscription GET /api/mastr-monitor/confirm/:token│
│  └── createFromSession POST /api/mastr-monitor/from-session │
│                                                             │
│  Internal (Scheduler):                                      │
│  ├── _runScheduledWatches (Cron, z.B. 06:00 Europe/Berlin)  │
│  └── _onMastrRefresh (Event-Trigger nach Datenimport)       │
│                                                             │
│  Modules:                                                   │
│  ├── src/mastr-monitor-diff.js (Delta-Engine)               │
│  ├── src/mastr-monitor-notify.js (Email-Sender)             │
│  └── src/mastr-monitor-scheduler.js (Cron + Event-Handler)  │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐
  │ Object Store│   │cernion_inst… │   │ nodemailer/SMTP  │
  │ (Watches,   │   │_local        │   │ (.env Config)    │
  │  Snapshots, │   │(MaStR Query) │   │                  │
  │  Deltas,    │   │              │   │                  │
  │  Subs)      │   │              │   │                  │
  └─────────────┘   └──────────────┘   └──────────────────┘
```

### Storage (Object Store Namespaces)

| Namespace | Key-Schema | Inhalt |
|---|---|---|
| `mastr_watches` | `{watchId}` | Watch-Definition (Query, Schedule, watchFields) |
| `mastr_snapshots` | `{watchId}:{isoDate}` | Installations-Snapshot (komprimiert) |
| `mastr_deltas` | `{watchId}:{isoDate}` | Delta-Report (added/removed/changed) |
| `mastr_subscriptions` | `{watchId}:{tokenHash}` | Email-Subscription (Double-Opt-In) |

### Kein neues PouchDB — Object Store reicht
Watches und Subscriptions sind klein (<10KB). Snapshots können größer
werden (1000 Installationen × 10 Felder ≈ 200–500KB), passen aber in
die 5MB Object-Store-Grenze pro Key. Für Watches mit >5000 Installationen:
Split-Document-Pattern (wie ZNP `znp:meta` / `znp:graph`).

---

## API Design

### 1) POST /api/mastr-monitor/watches — Watch erstellen

```json
{
  "name": "TWL Solar >100kW Monitoring",
  "query": {
    "gridOperatorMastrId": "SNB935578300972",
    "type": "solar",
    "minCapacity": 100,
    "status": "InBetrieb"
  },
  "watchFields": [
    "einheitBetriebsstatus",
    "nettonennleistung",
    "bruttoleistung",
    "inbetriebnahmedatum",
    "fernsteuerbarkeitDv",
    "netzbetreiberpruefungStatus",
    "direktvermarkterMastrNummer",
    "direktvermarkterName",
    "napData.spannungsebene",
    "lastUpdatedAt"
  ],
  "schedule": {
    "type": "cron",
    "expression": "0 6 * * 1-5",
    "timezone": "Europe/Berlin"
  },
  "notifications": [
    {
      "channel": "email",
      "to": "netzplanung@twl.de",
      "onlyOnChanges": true,
      "language": "de"
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "watchId": "twl-solar-gt100kw",
  "name": "TWL Solar >100kW Monitoring",
  "tokenUrl": "https://api.cernion.de/mastr-monitor/watch/abc123def456",
  "status": "pending_baseline",
  "message": "Watch erstellt. Erste Baseline wird jetzt erfasst.",
  "subscriptions": [
    {
      "email": "netzplanung@twl.de",
      "status": "pending_confirmation",
      "confirmUrl": "https://api.cernion.de/mastr-monitor/confirm/xyz789"
    }
  ]
}
```

**Ablauf nach Erstellung:**
1. Watch wird gespeichert
2. Baseline-Snapshot wird sofort ausgeführt (async Job)
3. Confirmation-Email an alle Subscriber
4. Watch ist erst nach Baseline + min. 1 bestätigter Subscription aktiv

### 2) GET /api/mastr-monitor/watches — Watches auflisten

Query-Parameter: `email` (optional) — filtert auf Watches dieser Email.
Alternativ: Bearer Token für token-basierte Authentifizierung.

Response:
```json
{
  "watches": [
    {
      "watchId": "twl-solar-gt100kw",
      "name": "TWL Solar >100kW Monitoring",
      "status": "active",
      "lastRun": "2026-04-16T06:00:00.000Z",
      "nextRun": "2026-04-17T06:00:00.000Z",
      "installationCount": 47,
      "lastDelta": {
        "added": 1,
        "removed": 0,
        "changed": 3,
        "timestamp": "2026-04-16T06:00:12.345Z"
      }
    }
  ],
  "total": 1
}
```

### 3) GET /api/mastr-monitor/watches/:id — Watch-Details

Response enthält: Watch-Definition, letzter Snapshot-Summary, letzter Delta,
Subscription-Status, Schedule-Info, Token-URL.

### 4) DELETE /api/mastr-monitor/watches/:id — Watch löschen

Löscht Watch, alle Snapshots, Deltas und Subscriptions.
Auth: Bearer Token ODER Token-Link.

### 5) POST /api/mastr-monitor/watches/:id/run — Manueller Trigger

Führt den Watch sofort aus: neuer Snapshot → Delta → Notification.
Async Job (202 + Polling).

### 6) GET /api/mastr-monitor/watches/:id/deltas — Delta-Historie

```json
{
  "watchId": "twl-solar-gt100kw",
  "deltas": [
    {
      "deltaId": "2026-04-16",
      "timestamp": "2026-04-16T06:00:12.345Z",
      "summary": { "added": 1, "removed": 0, "changed": 3 },
      "snapshotInstallations": 47
    },
    {
      "deltaId": "2026-04-15",
      "timestamp": "2026-04-15T06:00:08.123Z",
      "summary": { "added": 0, "removed": 0, "changed": 0 },
      "snapshotInstallations": 46
    }
  ]
}
```

### 7) GET /api/mastr-monitor/watches/:id/deltas/:deltaId — Delta-Details

```json
{
  "watchId": "twl-solar-gt100kw",
  "deltaId": "2026-04-16",
  "timestamp": "2026-04-16T06:00:12.345Z",
  "baseline": "2026-04-15",
  "summary": { "added": 1, "removed": 0, "changed": 3 },
  "added": [
    {
      "mastrNummer": "SEE949239824721",
      "name": "Solareinheit Kreiselmaier",
      "nettonennleistung": 705.705,
      "einheitBetriebsstatus": "35",
      "inbetriebnahmedatum": "2026-01-14",
      "ort": "Ludwigshafen",
      "postleitzahl": "67071"
    }
  ],
  "removed": [],
  "changed": [
    {
      "mastrNummer": "SEE920109192683",
      "name": "Ofenhallendamm Freifläche",
      "fields": [
        {
          "field": "netzbetreiberpruefungStatus",
          "label": "Netzbetreiberprüfung",
          "from": 2955,
          "fromLabel": "In Prüfung",
          "to": 2954,
          "toLabel": "Geprüft"
        }
      ],
      "lastUpdatedAt": "2026-04-15T14:30:00.000Z"
    },
    {
      "mastrNummer": "SEE900111222333",
      "name": "PV Mundenheim Ost",
      "fields": [
        {
          "field": "einheitBetriebsstatus",
          "label": "Betriebsstatus",
          "from": "31",
          "fromLabel": "In Planung",
          "to": "35",
          "toLabel": "In Betrieb"
        },
        {
          "field": "inbetriebnahmedatum",
          "label": "Inbetriebnahme",
          "from": null,
          "to": "2026-04-14"
        }
      ],
      "lastUpdatedAt": "2026-04-15T09:12:00.000Z"
    }
  ]
}
```

### 8) GET /api/mastr-monitor/watches/:id/snapshot — Aktueller Snapshot

Query-Parameter: `format=json|csv` (Default: json)
CSV-Format: identisch mit bestehender Live-CSV-Struktur.

### 9) POST /api/mastr-monitor/watches/:id/subscribe — Subscription

```json
{
  "email": "thorsten@twl.de",
  "onlyOnChanges": true,
  "language": "de"
}
```

Response:
```json
{
  "success": true,
  "status": "pending_confirmation",
  "message": "Bestätigungslink wurde an thorsten@twl.de gesendet."
}
```

### 10) GET /api/mastr-monitor/confirm/:token — Double-Opt-In

HTML-Seite mit Bestätigungsnachricht. Setzt Subscription auf `confirmed`.

### 11) DELETE /api/mastr-monitor/watches/:id/subscribe/:token — Unsubscribe

Token-basiert, kein Login nötig. Jede Email hat individuellen Unsubscribe-Token.

### 12) POST /api/mastr-monitor/from-session — Watch aus Live-CSV Session

```json
{
  "sessionId": "csv_session_abc123",
  "name": "Monitoring aus CSV-Session",
  "schedule": {
    "type": "cron",
    "expression": "0 6 * * 1"
  },
  "notifications": [
    { "channel": "email", "to": "netzplanung@twl.de", "onlyOnChanges": true }
  ]
}
```

Das System liest die Query-Parameter der Live-CSV Session und erstellt
daraus einen Watch mit identischen Filtern. Der Nutzer sieht: "Diese
Abfrage als Monitoring einrichten → Email eingeben → fertig."

---

## Delta-Engine (src/mastr-monitor-diff.js)

### Algorithmus

```
DIFF(snapshotPrev, snapshotCurr, watchFields):

  1. Index: prevMap = Map(mastrNummer → installation) für snapshotPrev
             currMap = Map(mastrNummer → installation) für snapshotCurr

  2. ADDED: Alle mastrNummer in currMap die nicht in prevMap sind
     → Komplettes Installationsobjekt zurückgeben

  3. REMOVED: Alle mastrNummer in prevMap die nicht in currMap sind
     → Letzten bekannten Stand zurückgeben + Grund-Heuristik:
       - Status geändert zu "38" (dauerhaft stillgelegt)? → "Stilllegung"
       - Aus Filter gefallen (z.B. Kapazität unter Schwelle)? → "Filter-Mismatch"
       - Komplett gelöscht aus MaStR? → "MaStR-Löschung"

  4. CHANGED (Feld-Level): Für jede mastrNummer in BEIDEN Maps:
     a) Quick-Check: lastUpdatedAt unverändert? → Skip (keine Änderung)
     b) Für jedes Feld in watchFields:
        - prevValue = get(prevInstallation, field)  // supports dot-notation
        - currValue = get(currInstallation, field)
        - Wenn prevValue ≠ currValue → { field, from, to, fromLabel?, toLabel? }
     c) Labels: Für kodierte Felder (Betriebsstatus 35→"In Betrieb") ein
        Label-Mapping aus MaStR-Katalogwerten bereitstellen

  5. SUMMARY: { added: N, removed: N, changed: N, unchanged: N, total: N }

  Return: { added[], removed[], changed[], summary, timestamp }
```

### Performance-Optimierung über lastUpdatedAt

`lastUpdatedAt` ist das MaStR-seitige Änderungsdatum. Die Delta-Engine
nutzt es als Pre-Filter:

```javascript
// Schneller Vorab-Check: Installation seit letztem Snapshot unverändert?
function hasChanged(prev, curr) {
  if (!prev || !curr) return true; // added or removed
  // lastUpdatedAt ist der MaStR-seitige Timestamp
  const prevUpdated = prev.lastUpdatedAt || prev.updatedAt;
  const currUpdated = curr.lastUpdatedAt || curr.updatedAt;
  if (prevUpdated && currUpdated && prevUpdated === currUpdated) {
    return false; // MaStR hat den Datensatz nicht angefasst → kein Diff nötig
  }
  return true;
}
```

Bei einem Watch mit 1000 Installationen und 5 Änderungen pro Woche
reduziert das die Feldvergleiche von ~10.000 auf ~50.

### MaStR-Katalog-Labels

```javascript
const MASTR_LABELS = {
  einheitBetriebsstatus: {
    '31': 'In Planung',
    '35': 'In Betrieb',
    '37': 'Vorübergehend stillgelegt',
    '38': 'Dauerhaft stillgelegt',
  },
  netzbetreiberpruefungStatus: {
    2954: 'Geprüft',
    2955: 'In Prüfung',
    3075: 'Nicht vorgesehen',
  },
  'napData.spannungsebene': {
    342: 'Höchstspannung (EHV)',
    347: 'Hochspannung (HV)',
    352: 'Mittelspannung (MV)',
    354: 'Niederspannung (LV)',
  },
};
```

### Default-WatchFields

```javascript
const DEFAULT_WATCH_FIELDS = [
  'einheitBetriebsstatus',
  'nettonennleistung',
  'bruttoleistung',
  'inbetriebnahmedatum',
  'fernsteuerbarkeitDv',
  'netzbetreiberpruefungStatus',
  'direktvermarkterMastrNummer',
  'direktvermarkterName',
  'napData.spannungsebene',
  'lastUpdatedAt',
];
```

---

## Snapshot-Strategie

### Was wird gespeichert?

Pro Snapshot: Nur die `watchFields` + Identifikationsfelder, nicht die
gesamte Installation. Das reduziert die Snapshot-Größe erheblich.

```javascript
function buildSnapshotEntry(installation, watchFields) {
  const entry = {
    mastrNummer: installation.mastrNummer,
    name: installation.name,
    ort: installation.ort,
    postleitzahl: installation.postleitzahl,
    lastUpdatedAt: installation.lastUpdatedAt,
  };
  for (const field of watchFields) {
    entry[field] = getNestedValue(installation, field);
  }
  return entry;
}
```

### Retention

- Snapshots: Letzte 30 behalten, ältere löschen (konfigurierbar)
- Deltas: Letzte 90 Tage (Deltas sind klein, ~5KB pro Stück)
- Bei Watch-Löschung: Alles löschen

---

## Scheduling (src/mastr-monitor-scheduler.js)

### Dual-Trigger (Option C)

**Cron-basiert:**
```javascript
// In service.started():
this.cronInterval = setInterval(() => {
  this.checkScheduledWatches();
}, 60000); // Jede Minute prüfen ob Watches fällig sind

async checkScheduledWatches() {
  const watches = await this.loadAllWatches();
  const now = new Date();
  for (const watch of watches) {
    if (watch.status !== 'active') continue;
    if (this.isDue(watch.schedule, watch.lastRun, now)) {
      await this.executeWatch(watch.watchId);
    }
  }
}
```

**Event-basiert:**
```javascript
// Moleculer-Event-Listener
events: {
  'mastr.data.refreshed'(payload) {
    // Wenn MaStR-Daten aktualisiert wurden → alle betroffenen Watches prüfen
    this.onMastrRefresh(payload);
  }
}

async onMastrRefresh(payload) {
  const watches = await this.loadAllWatches();
  for (const watch of watches) {
    if (watch.status !== 'active') continue;
    // Prüfe ob der Refresh diesen Watch betrifft
    if (this.isAffected(watch.query, payload)) {
      await this.executeWatch(watch.watchId);
    }
  }
}
```

### Cron-Expression-Parsing

Minimal: `node-cron` Syntax (5-Feld). Vordefinierte Presets:

| Preset | Cron | Beschreibung |
|---|---|---|
| `daily_morning` | `0 6 * * *` | Täglich 06:00 |
| `weekday_morning` | `0 6 * * 1-5` | Mo–Fr 06:00 |
| `weekly_monday` | `0 6 * * 1` | Montag 06:00 |
| `monthly_first` | `0 6 1 * *` | 1. des Monats 06:00 |

---

## Email-Notifications (src/mastr-monitor-notify.js)

### .env Konfiguration (NEU)

```env
# MaStR Monitoring Email (SMTP)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=monitoring@twl-netz.de
SMTP_PASS=***
SMTP_FROM="Cernion MaStR Monitor <monitoring@twl-netz.de>"

# Optional: Basis-URL für Token-Links und Unsubscribe
MASTR_MONITOR_BASE_URL=https://api.cernion.de
```

### Email-Templates

**1. Confirmation-Email (Double-Opt-In)**
```
Betreff: MaStR Monitoring bestätigen — {watchName}

Hallo,

Sie wurden für das MaStR Monitoring "{watchName}" registriert.

Bitte bestätigen Sie Ihre Anmeldung:
→ {confirmUrl}

Filter: {queryDescription}
Zeitplan: {scheduleDescription}

Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese Email.
```

**2. Delta-Notification**
```
Betreff: MaStR Änderungen erkannt — {watchName} ({addedCount} neu,
         {changedCount} geändert, {removedCount} entfernt)

Hallo,

Beim Monitoring "{watchName}" wurden Änderungen erkannt:

━━━ ZUSAMMENFASSUNG ━━━
• {addedCount} neue Installationen
• {changedCount} geänderte Installationen
• {removedCount} entfernte Installationen
• {unchangedCount} unverändert (von {totalCount} gesamt)

━━━ NEUE INSTALLATIONEN ━━━
{#each added}
• {mastrNummer} — {name} ({nettonennleistung} kW, {ort})
  Status: {statusLabel}, Inbetriebnahme: {inbetriebnahmedatum}
{/each}

━━━ ÄNDERUNGEN ━━━
{#each changed}
• {mastrNummer} — {name}
  {#each fields}
  ↳ {label}: {fromLabel} → {toLabel}
  {/each}
{/each}

━━━ ENTFERNTE INSTALLATIONEN ━━━
{#each removed}
• {mastrNummer} — {name} (Grund: {removalReason})
{/each}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vollständiger Report: {deltaUrl}
Aktueller Snapshot (CSV): {snapshotCsvUrl}
Watch verwalten: {tokenUrl}
Abmelden: {unsubscribeUrl}
```

**3. No-Changes-Summary (optional, konfigurierbar)**
```
Betreff: MaStR Monitoring — keine Änderungen ({watchName})

Beim Monitoring "{watchName}" wurden heute keine Änderungen erkannt.
Nächste Prüfung: {nextRun}
```

### Email-Versand

```javascript
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}
```

### Graceful Degradation

Wenn SMTP nicht konfiguriert ist (`!process.env.SMTP_HOST`):
- Watches funktionieren weiterhin (Snapshots + Deltas werden erstellt)
- Email-Subscriptions geben Fehler `SMTP_NOT_CONFIGURED` (503)
- Deltas sind über API abrufbar (Polling, Token-Link, /app)
- Log-Warnung beim Service-Start

---

## Integration: Live-CSV → Watch (from-session)

### Ablauf

```
1. User hat Live-CSV Session mit Query-Parametern:
   {
     "gridOperatorMastrId": "SNB935578300972",
     "type": "solar",
     "minCapacity": 100,
     "format": "csv"
   }

2. User klickt "Als Monitoring einrichten" (in /app oder API)

3. POST /api/mastr-monitor/from-session
   {
     "sessionId": "csv_session_abc123",
     "name": "Auto: TWL Solar >100kW",
     "schedule": { "type": "preset", "preset": "weekday_morning" },
     "notifications": [{ "channel": "email", "to": "user@example.com" }]
   }

4. Backend:
   a) Lade Session-Query-Parameter
   b) Entferne format/limit/offset (sind Darstellungs-Parameter)
   c) Erstelle Watch mit extrahierten Query-Parametern
   d) Führe Baseline-Snapshot aus
   e) Schicke Confirmation-Email
```

### /app Mini-App Integration

In der bestehenden `/app` Mini-App (falls vorhanden) wird ein neuer
Bereich ergänzt:

```
┌─────────────────────────────────────────┐
│  📊 MaStR Live-Abfrage                 │
│  [Filter: TWL Netze | Solar | >100kW]  │
│  [▶ Abfrage ausführen]                 │
│                                        │
│  Ergebnis: 47 Installationen           │
│  [📥 CSV Download]  [🔔 Monitoring]    │
│                                        │
│  ─────────────────────────────────────  │
│                                        │
│  🔔 Meine Monitorings                  │
│  ┌─────────────────────────────────┐   │
│  │ TWL Solar >100kW               │   │
│  │ Status: Aktiv | Letzte Prüfung:│   │
│  │ 16.04.2026 06:00               │   │
│  │ Letzte Änderungen: 1 neu,      │   │
│  │ 3 geändert                     │   │
│  │ [Details] [⏸ Pause] [🗑 Löschen]│   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Heidelberg Wind alle            │   │
│  │ Status: Aktiv | Keine Änderungen│   │
│  │ [Details] [⏸ Pause] [🗑 Löschen]│   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## DSGVO-Compliance

1. **Double-Opt-In:** Jede Email-Subscription muss bestätigt werden
2. **Unsubscribe:** Jede Email enthält individuellen Unsubscribe-Link
3. **Datensparsamkeit:** Snapshots enthalten nur watchFields, keine
   personenbezogenen Daten der Anlagenbetreiber (Name/Adresse werden
   NICHT in Snapshots gespeichert, nur MaStR-Nummer + technische Felder)
4. **Löschung:** Watch-Löschung löscht alle zugehörigen Daten
5. **Kein Tracking:** Keine Öffnungsraten, keine Klick-Tracking-Pixel
6. **Rechtsgrundlage:** Art. 6 Abs. 1 lit. a DSGVO (Einwilligung via
   Double-Opt-In)

---

## Neue Dependency

```
npm install nodemailer --save
```

Keine weitere Dependency nötig. `node-cron` wird NICHT verwendet —
stattdessen ein einfacher setInterval + isDue-Check basierend auf
cron-expression-Parsing (wie in ZNP job-store).

---

## Plattform-Impact

| Metrik | Vorher | Nachher | Delta |
|---|---|---|---|
| Services | 44 | 45 | +1 (mastr-monitor) |
| REST-Endpoints | 120 | 132 | +12 |
| Source-Module | — | +3 | diff, notify, scheduler |
| Object Store Namespaces | 2 (cya_*) | 6 | +4 (mastr_*) |
| .env Variablen | ~10 | ~16 | +6 (SMTP_*) |
| Dependency | — | +1 | nodemailer |

---

## Copilot-Prompt-Struktur (empfohlen)

### Prompt 1/4: Service-Skelett + Watch CRUD
- mastr-monitor.service.js mit 12 Actions (Stubs für run/delta/scheduler)
- API-Routes in api.service.js
- skipServices in agent.service.js
- OpenAPI-Tags und Annotationen
- Basis-Tests

### Prompt 2/4: Delta-Engine + Snapshot-Management
- src/mastr-monitor-diff.js (Algorithmus, Labels, lastUpdatedAt-Optimierung)
- Snapshot-Builder (buildSnapshotEntry, Retention)
- runWatch-Handler vervollständigen
- Tests: Delta-Szenarien (added, removed, changed, no-change, label-mapping)

### Prompt 3/4: Email-Notifications + Scheduling
- src/mastr-monitor-notify.js (nodemailer, Templates, Double-Opt-In)
- src/mastr-monitor-scheduler.js (Cron + Event-Trigger)
- .env.example erweitern
- subscribe/unsubscribe/confirm-Handler vervollständigen
- Tests: SMTP-Mock, Template-Rendering, Schedule-Check

### Prompt 4/4: Live-CSV-Integration + /app UI + UI-Contract
- from-session Handler
- /app Mini-App Erweiterung (Monitoring-Button + Watch-Liste)
- docs/ui-contracts/21-mastr-monitor.md
- CHANGELOG + BACKEND_CONTEXT Update
- Gesamtverifikation

---

## Offene Entscheidungen

### E1: Snapshot-Limit
Wie viele Installationen kann ein einzelner Watch maximal überwachen?
Empfehlung: 5.000 (darüber: Split-Warn + "Bitte Filter einengen").

### E2: Delta-Retention
Wie lange werden Deltas aufbewahrt?
Empfehlung: 90 Tage (danach automatische Löschung).

### E3: Email-Rate-Limit
Wie viele Emails pro Watch pro Tag maximal?
Empfehlung: 1 Digest-Email pro Run (nicht pro Änderung).

### E4: MaStR-Refresh-Event
Gibt es bereits ein Moleculer-Event `mastr.data.refreshed`?
Wenn nicht: Muss in den MaStR-Import-Prozess eingebaut werden.

### E5: Token-Link Basis-URL
`MASTR_MONITOR_BASE_URL` — ist das die Cernion-API-URL oder eine
separate Landing-Page? Für die /app-Integration wäre eine Frontend-URL
besser (z.B. `https://cernion.de/app/monitor/...`).

### E6: Betreiber-Daten in Deltas?
Sollen Betreiber-Namen in Delta-Emails erscheinen?
DSGVO-Risiko: Betreiber-Name kann personenbezogen sein (Einzelunternehmer).
Empfehlung: Nur MaStR-Nummer + technischer Anlagenname + Ort,
NICHT Betreiber-Name/-Adresse.
