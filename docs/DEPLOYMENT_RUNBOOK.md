# Cernion Energy Tools — Deployment Runbook

**Version:** 0.34.0 | **Stand:** 2026-04-29
**Zielgruppe:** Ops-Team / Systemadministrator

---

## 1. Systemvoraussetzungen

### Node.js & Runtime
| Anforderung | Wert |
|-------------|------|
| Node.js | ≥ 22.x (getestet: v22.22.0) |
| npm | ≥ 10.x |
| Betriebssystem | Linux (getestet: Ubuntu 24.04 LTS) |
| Architektur | x86_64 |

### Ressourcen (Mindestanforderungen Produktion)
| Ressource | Minimum | Empfohlen |
|-----------|---------|-----------|
| RAM | 512 MB | 2 GB |
| Disk | 5 GB | 20 GB (SQLite WAL + PouchDB-Wachstum bei 1 Jahr Betrieb) |
| CPU | 1 vCore | 2 vCores |

### Netzwerk-Ports
| Port | Protokoll | Dienst | Konfiguration |
|------|-----------|--------|---------------|
| 3000 | TCP/HTTP | API Gateway (REST + OpenAPI/Swagger) | `PORT` in `.env` |
| — | intern | Moleculer In-Process Bus | kein externer Port |
| — | intern | MQTT-Broker (embedded Aedes) | kein externer TCP-Port; internes PouchDB |

> **KRITIS-Prinzip:** Alle Datenspeicher sind embedded (PouchDB/LevelDB + SQLite WAL).
> Es werden **keine** externen Datenbankserver (PostgreSQL, MongoDB, Redis, Mosquitto o.ä.)
> benötigt. Das System ist offline-fähig und betreibt keinen externen Netzwerkprozess
> außer dem API Gateway auf Port 3000.

---

## 2. Installation

### 2.1 Repository klonen / Paket entpacken

```bash
# Option A: Git
git clone https://github.com/<org>/cernion-energy-tools.git
cd cernion-energy-tools
git checkout v0.34.0

# Option B: Tarball
tar -xzf cernion-energy-tools-0.34.0.tar.gz
cd cernion-energy-tools
```

### 2.2 Abhängigkeiten installieren

```bash
npm install --omit=dev   # Produktion (ohne DevDependencies)
# ODER für Entwicklung:
npm install
```

> **Hinweis:** `better-sqlite3` kompiliert native Bindings. Sicherstellen dass
> `build-essential`, `python3` und `node-gyp` verfügbar sind:
> ```bash
> apt-get install -y build-essential python3
> ```

### 2.3 .env konfigurieren

```bash
cp .env.example .env
$EDITOR .env
```

Mindest-Konfiguration für Produktionsbetrieb — alle anderen Felder sind optional:

```ini
# Pflichtfelder Produktion
PORT=3000
API_URL=https://ihre-domain.example.com
GEMINI_API_KEY=<Ihr-Gemini-API-Key>
CERNION_TOKEN=<Ihr-Cernion-MCP-Token>
LOG_LEVEL=warn
```

Vollständige Variable-Referenz: siehe Abschnitt 4.

### 2.4 Verzeichnisstruktur anlegen

```bash
mkdir -p data/{edm,object-store,mqtt-broker,znp,jobs}
mkdir -p uploads
touch uploads/.gitkeep
```

---

## 3. Start / Stopp

### 3.1 Produktivstart

```bash
npm start
# Äquivalent: node index.js
```

Erwartete Startmeldung:
```
[CERNION] INFO  moleculer: Broker started.
[CERNION] INFO  api: API Gateway started on port 3000
```

### 3.2 Entwicklungsstart (Hot-Reload)

```bash
npm run dev
```

### 3.3 Graceful Shutdown

Das System reagiert auf `SIGTERM` (für systemd/PM2) und `SIGINT` (Ctrl+C).
Moleculer stoppt alle Services geordnet; laufende Requests werden abgeschlossen
bevor der Prozess beendet wird (`TRACKING_SHUTDOWN_TIMEOUT_MS`, Default: 5000 ms).

```bash
kill -SIGTERM <PID>
```

### 3.4 Health-Check

```bash
# Swagger UI erreichbar?
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/docs

# CYA-Templates erreichbar (funktionaler Smoke-Test)?
curl -s http://localhost:3000/api/cya/templates | jq '.length'
```

> **Hinweis:** Ein dedizierter `GET /api/health` Endpoint ist in v0.34.0 nicht implementiert.
> Der obige Templates-Call (statische Daten, keine externen Abhängigkeiten) ist der
> zuverlässigste Smoke-Test.

### 3.5 Prozess-Manager: PM2 (empfohlen)

```bash
# Installation
npm install -g pm2

# Start
pm2 start index.js --name cernion-energy-tools --max-memory-restart 1G

# Autostart nach Reboot
pm2 startup
pm2 save

# Nützliche Kommandos
pm2 status
pm2 logs cernion-energy-tools
pm2 restart cernion-energy-tools
pm2 stop cernion-energy-tools
```

### 3.6 Prozess-Manager: systemd-Unit

Datei: `/etc/systemd/system/cernion.service`

```ini
[Unit]
Description=Cernion Energy Tools
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=cernion
WorkingDirectory=/opt/cernion-energy-tools
ExecStart=/usr/bin/node /opt/cernion-energy-tools/index.js
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cernion
# Umgebungsvariablen aus Datei laden
EnvironmentFile=/opt/cernion-energy-tools/.env
# Ressourcen-Limits
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

```bash
# Aktivieren
systemctl daemon-reload
systemctl enable cernion
systemctl start cernion
systemctl status cernion

# Logs
journalctl -u cernion -f
```

---

## 4. Konfiguration

### 4.1 Vollständige .env-Referenz

#### Moleculer / Laufzeit

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `NAMESPACE` | `cernion` | Moleculer Namespace (Isolation mehrerer Instanzen) |
| `NODE_ID` | (leer = auto) | Eindeutige Node-ID im Cluster |
| `LOG_LEVEL` | `info` | Log-Level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `REQUEST_TIMEOUT_MS` | `900000` | Globaler Request-Timeout in ms (15 min für lange MCP-Calls) |
| `TRANSPORTER` | (leer) | Moleculer Transporter (leer = In-Process; alternativ `nats://...`) |
| `CACHER` | (leer) | Moleculer Cacher (leer = kein; alternativ `Memory`) |

#### Zuverlässigkeit (Production Hardening)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `RETRY_POLICY_ENABLED` | `false` | Automatische Retry-Policy aktivieren |
| `RETRY_POLICY_RETRIES` | `5` | Anzahl Retry-Versuche |
| `RETRY_POLICY_DELAY_MS` | `100` | Initiales Retry-Delay in ms |
| `RETRY_POLICY_MAX_DELAY_MS` | `1000` | Maximales Retry-Delay in ms (exponential backoff) |
| `RETRY_POLICY_FACTOR` | `2` | Backoff-Faktor |
| `CIRCUIT_BREAKER_ENABLED` | `false` | Circuit-Breaker aktivieren |
| `CIRCUIT_BREAKER_THRESHOLD` | `0.5` | Fehlerquote für Öffnung (0.0–1.0) |
| `BULKHEAD_ENABLED` | `false` | Bulkhead-Pattern aktivieren |
| `BULKHEAD_CONCURRENCY` | `10` | Max. parallele Requests |
| `TRACKING_ENABLED` | `false` | Request-Tracking für Graceful Shutdown |
| `TRACKING_SHUTDOWN_TIMEOUT_MS` | `5000` | Shutdown-Wartezeit in ms |

#### API Gateway

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `PORT` | `3000` | TCP-Port des API Gateways |
| `API_URL` | `http://localhost:3000` | Externe Basis-URL (für Swagger UI + OpenAPI) |

#### KI / LLM

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `GEMINI_API_KEY` | (leer) | **Pflicht.** Google Gemini API Key |
| `GEMINI_MODEL` | `gemini-3-pro-preview` | Gemini Modell-ID |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Embedding-Modell für Cookbook-Suche |
| `ASYNC_POLLER_DEBUG` | `false` | Detailliertes Logging für async Job-Poller |

#### MCP / Cernion Backend

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `CERNION_TOKEN` | (leer) | **Pflicht.** Cernion MCP API-Token (erhalten von cernion.de) |
| `OVERPASS_ENDPOINT` | (leer = public) | Overpass API URL (leer = öffentliche Instanz; für SLA eigene Instanz verwenden) |

#### VNB-Identität (optional)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `CERNION_VNB_MASTR_ID` | (leer) | MaStR-ID des Netzbetreibers (z.B. `SNB930000000001`) |
| `CERNION_VNB_ID` | (leer) | VNBdigital VNB-ID |
| `CERNION_VNB_NAME` | (leer) | Anzeigename des VNB |
| `CERNION_VNB_BDEW` | (leer) | BDEW-Code des VNB |

#### Datenspeicher (PouchDB / SQLite)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `OBJECT_STORE_DB_PATH` | `./data/object-store` | PouchDB für CYA Sessions, Profile, Tokens, Monitor-Daten |
| `EDM_DB_PATH` | `data/edm` | SQLite WAL (Zeitreihendaten, partitionsweise) |
| `EDM_RETENTION_DAYS` | `1095` | Datenhaltungsdauer in Tagen (3 Jahre) |
| `EDM_RETENTION_POLICY` | `delete` | Retention-Aktion: `delete` oder `archive` |
| `ZNP_DB_PATH` | `./data/znp` | PouchDB für ZNP-Projektmetadaten |
| `DATAPOINT_DB_PATH` | `./.datapoints` | PouchDB für Named Datapoints |
| `GRID_CONNECTION_DB_PATH` | `./.grid-connections` | PouchDB für Netzanschluss-Validierungen |
| `ENERGY_SHARING_DB_PATH` | `./.energy-sharing` | PouchDB für Energy-Sharing-Validierungen |
| `ALLOCATION_ENGINE_DB_PATH` | `./.allocation-engine` | PouchDB für Allocation Engine |
| `MASTR_QUALITY_DB_PATH` | `./.mastr-quality` | PouchDB für MaStR-Qualitätsaudits |
| `REDISPATCH_EXPOST_DB_PATH` | `./.redispatch-expost` | PouchDB für Redispatch Ex-Post Audits |
| `MQTT_BROKER_DB_PATH` | `./data/mqtt-broker` | PouchDB für MQTT-Persistenz (QoS 2) |

#### Datapoint Layer / Scheduling

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `DATAPOINT_SCHEDULER_ENABLED` | `true` | Automatische 60s-Refresh-Ticks |
| `DATAPOINT_MAX_CONCURRENT_REFRESHES` | `3` | Max. parallele Scheduler-Refreshes (verhindert MCP-Overflow) |
| `OEP_API_BASE_URL` | `https://openenergyplatform.org/api/v0` | Open Energy Platform API (für OEMetadata) |

#### MaStR Monitoring (Email)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `SMTP_HOST` | (leer) | SMTP-Server-Hostname |
| `SMTP_PORT` | (leer) | SMTP-Port (typisch: 587 STARTTLS, 465 TLS) |
| `SMTP_SECURE` | `false` | TLS für SMTP (`true` = Port 465) |
| `SMTP_USER` | (leer) | SMTP-Benutzername |
| `SMTP_PASS` | (leer) | SMTP-Passwort |
| `SMTP_FROM` | `"Cernion MaStR Monitor <monitoring@example.de>"` | Absenderadresse |
| `MASTR_MONITOR_BASE_URL` | `https://api.cernion.de` | Basis-URL für Bestätigungslinks in Emails |
| `MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH` | `50000` | Max. Installationen pro Watch-Run |
| `MASTR_MONITOR_CHUNKING_ENABLED` | `true` | Chunked Persistence für große Snapshots |
| `MASTR_MONITOR_CHUNK_SIZE` | `1000` | Chunk-Größe |
| `MASTR_MONITOR_EMAIL_DETAIL_LIMIT` | `100` | Max. Detail-Einträge pro Email-Sektion |

#### Integration Hub / Token Manager

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `TOKEN_STORAGE_FILE` | `./uploads/.api-tokens.json` | Speicherort für API-Tokens (SHA-256, nicht plain) |
| `CERNION_PUBLIC_URL` | `https://your-cernion-instance.example.com` | Öffentliche URL für Power BI/Power Automate Snippets |

#### VNB Monitor / NBP Monitor

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `VNB_MONITOR_CACHE_TTL_SECONDS` | `3600` | Cache-TTL für VNB-Monitor (1 Stunde) |
| `VNB_MONITOR_DEFAULT_BDEW_CODES` | `10002954` | Kommagetrennte BDEW-Codes zum Monitoring |
| `NBP_CACHE_TTL_SECONDS` | `86400` | Cache-TTL für NBP-Monitor (24 Stunden) |

#### Cookbook

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `COOKBOOK_VALIDATION_INTERVAL_MS` | `300000` | Validierungsintervall in ms (5 Minuten) |
| `COOKBOOK_RELATED_LIMIT` | `3` | Anzahl auto-verlinkter verwandter Rezepte |
| `COOKBOOK_RELATED_MIN_SCORE` | `0.72` | Mindestscore für semantische Verlinkung |

### 4.2 SQLite WAL-Modus

WAL ist bereits im Code aktiviert (`better-sqlite3`, WAL-Modus, WITHOUT ROWID-Tabellen).
Keine manuelle Konfiguration erforderlich. WAL erlaubt parallele Reads während eines
Writes — ideal für den produktiven Einsatz.

---

## 5. Backup & Recovery

### 5.1 Was muss gesichert werden

| Kategorie | Pfad | Inhalt |
|-----------|------|--------|
| **SQLite Zeitreihen** | `data/edm/` | EDM-Messdaten, SLP-Profile (WAL-Dateien) |
| **PouchDB Object Store** | `data/object-store/` | CYA Sessions, Profile, Tokens, MaStR Monitor |
| **PouchDB MQTT** | `data/mqtt-broker/` | QoS 2-Persistenz, Steuerbefehl-Audit |
| **PouchDB ZNP** | `data/znp/` | Zielnetzplanungs-Projektdaten |
| **PouchDB Agenten** | `data/mastr-quality/`, `data/redispatch-expost/`, `data/energy-sharing/`, `data/allocation-engine/` | Agent-Audittrails |
| **Named Datapoints** | `.datapoints/` | Verwaltete Datenquellen mit OEMetadata |
| **Grid Connections** | `.grid-connections/` | Netzanschluss-Validierungsberichte |
| **Token-Datei** | `uploads/.api-tokens.json` | API-Tokens (SHA-256, kein Plaintext) |
| **Konfiguration** | `.env` | Systemkonfiguration |

> **Nicht gesichert werden müssen:** `node_modules/`, `tmp/`, `data/jobs/` (transiente Jobs),
> Test-PouchDBs (`data/object-store-*-test-*`, `data/znp-test-*`).

### 5.2 Backup-Strategie

Das folgende Skript implementiert eine 7-Tage-Rolling-Backup-Strategie.

**Datei:** `/opt/cernion-energy-tools/scripts/backup.sh`

```bash
#!/usr/bin/env bash
# Cernion Energy Tools — Backup-Skript
# Verwendung: bash scripts/backup.sh [BACKUP_DIR]
# Empfehlung: täglich via cron: 0 2 * * * /opt/cernion-energy-tools/scripts/backup.sh

set -euo pipefail

APP_DIR="/opt/cernion-energy-tools"
BACKUP_ROOT="${1:-/var/backups/cernion}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
RETENTION_DAYS=7

echo "[$(date)] Starte Backup nach: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# ── 1. SQLite EDM Zeitreihen (WAL-safe via .backup Kommando) ──────────────────
EDM_PATH="${APP_DIR}/data/edm"
if [ -d "${EDM_PATH}" ]; then
  echo "[$(date)] Sichere SQLite EDM..."
  mkdir -p "${BACKUP_DIR}/edm"
  for DB_FILE in "${EDM_PATH}"/*.sqlite3 "${EDM_PATH}"/*.db 2>/dev/null; do
    [ -f "${DB_FILE}" ] || continue
    FNAME="$(basename "${DB_FILE}")"
    sqlite3 "${DB_FILE}" ".backup '${BACKUP_DIR}/edm/${FNAME}'"
    echo "  ✓ ${FNAME}"
  done
fi

# ── 2. PouchDB/LevelDB Verzeichnisse ─────────────────────────────────────────
POUCHDBS=(
  "data/object-store"
  "data/mqtt-broker"
  "data/znp"
  "data/mastr-quality"
  "data/redispatch-expost"
  "data/energy-sharing"
  "data/allocation-engine"
  ".datapoints"
  ".grid-connections"
)

echo "[$(date)] Sichere PouchDB-Verzeichnisse..."
for DB_PATH in "${POUCHDBS[@]}"; do
  FULL_PATH="${APP_DIR}/${DB_PATH}"
  if [ -d "${FULL_PATH}" ]; then
    DEST="${BACKUP_DIR}/$(basename "${DB_PATH}")"
    cp -r "${FULL_PATH}" "${DEST}"
    echo "  ✓ ${DB_PATH}"
  fi
done

# ── 3. Konfiguration und Token-Datei ─────────────────────────────────────────
echo "[$(date)] Sichere Konfiguration..."
[ -f "${APP_DIR}/.env" ]                     && cp "${APP_DIR}/.env"                     "${BACKUP_DIR}/dot-env"
[ -f "${APP_DIR}/uploads/.api-tokens.json" ] && cp "${APP_DIR}/uploads/.api-tokens.json" "${BACKUP_DIR}/api-tokens.json"

# ── 4. Archivieren ────────────────────────────────────────────────────────────
echo "[$(date)] Erstelle tar.gz Archiv..."
tar -czf "${BACKUP_DIR}.tar.gz" -C "${BACKUP_ROOT}" "${TIMESTAMP}/"
rm -rf "${BACKUP_DIR}"
echo "  ✓ ${BACKUP_DIR}.tar.gz ($(du -sh "${BACKUP_DIR}.tar.gz" | cut -f1))"

# ── 5. Alte Backups löschen (Rolling 7 Tage) ─────────────────────────────────
echo "[$(date)] Bereinige Backups älter als ${RETENTION_DAYS} Tage..."
find "${BACKUP_ROOT}" -name "*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "  ✓ Bereinigung abgeschlossen"

echo "[$(date)] Backup erfolgreich: ${BACKUP_DIR}.tar.gz"
```

```bash
# Skript ausführbar machen
chmod +x /opt/cernion-energy-tools/scripts/backup.sh

# Cronjob einrichten (täglich 02:00 Uhr)
echo "0 2 * * * root /opt/cernion-energy-tools/scripts/backup.sh >> /var/log/cernion-backup.log 2>&1" \
  | sudo tee /etc/cron.d/cernion-backup
```

### 5.3 Recovery-Prozedur

```bash
# 1. Dienst stoppen
systemctl stop cernion
# oder: pm2 stop cernion-energy-tools

# 2. Backup entpacken
BACKUP_FILE="/var/backups/cernion/20260429_020000.tar.gz"
RESTORE_DIR="/tmp/cernion-restore"
mkdir -p "${RESTORE_DIR}"
tar -xzf "${BACKUP_FILE}" -C "${RESTORE_DIR}"
SNAPSHOT_DIR=$(ls "${RESTORE_DIR}/")

# 3. Daten einspielen
APP_DIR="/opt/cernion-energy-tools"

# PouchDB-Verzeichnisse
for DIR in object-store mqtt-broker znp mastr-quality redispatch-expost energy-sharing allocation-engine; do
  [ -d "${RESTORE_DIR}/${SNAPSHOT_DIR}/${DIR}" ] || continue
  rm -rf "${APP_DIR}/data/${DIR}"
  cp -r "${RESTORE_DIR}/${SNAPSHOT_DIR}/${DIR}" "${APP_DIR}/data/${DIR}"
done

# Datapoints (Hidden-Dirs)
[ -d "${RESTORE_DIR}/${SNAPSHOT_DIR}/.datapoints" ]     && cp -r "${RESTORE_DIR}/${SNAPSHOT_DIR}/.datapoints"     "${APP_DIR}/"
[ -d "${RESTORE_DIR}/${SNAPSHOT_DIR}/.grid-connections" ] && cp -r "${RESTORE_DIR}/${SNAPSHOT_DIR}/.grid-connections" "${APP_DIR}/"

# SQLite (WAL-safe Backup bereits konsistent)
[ -d "${RESTORE_DIR}/${SNAPSHOT_DIR}/edm" ] && cp -r "${RESTORE_DIR}/${SNAPSHOT_DIR}/edm/." "${APP_DIR}/data/edm/"

# Konfiguration
[ -f "${RESTORE_DIR}/${SNAPSHOT_DIR}/dot-env" ] && cp "${RESTORE_DIR}/${SNAPSHOT_DIR}/dot-env" "${APP_DIR}/.env"
[ -f "${RESTORE_DIR}/${SNAPSHOT_DIR}/api-tokens.json" ] && cp "${RESTORE_DIR}/${SNAPSHOT_DIR}/api-tokens.json" "${APP_DIR}/uploads/.api-tokens.json"

# 4. Dienst starten
systemctl start cernion
# oder: pm2 start cernion-energy-tools

# 5. Verify
sleep 5
curl -s http://localhost:3000/api/cya/templates | jq '.length'
# Erwartung: Zahl > 0 (z.B. 6)
```

### 5.4 MQTT-Persistenz-Recovery

Der eingebettete MQTT-Broker persistiert QoS 2-Nachrichten und Retained-State
in der PouchDB unter `data/mqtt-broker/`. Bei Korruption dieser Datenbank:

```bash
# 1. Dienst stoppen
systemctl stop cernion

# 2. MQTT-PouchDB löschen (Clients reconnecten automatisch, QoS 2-Resync)
rm -rf /opt/cernion-energy-tools/data/mqtt-broker/
mkdir -p /opt/cernion-energy-tools/data/mqtt-broker/

# 3. Dienst starten
systemctl start cernion
```

**Auswirkung:** Noch nicht bestätigte QoS 2-Steuerbefehle werden nicht neu zugestellt.
MQTT-Clients (z.B. §14a-Steuerboxen) reconnecten und subscriben neu. Für den
Entlastungsnachweis bereits gespeicherte Daten bleiben im Object Store erhalten.

---

## 6. Monitoring

### 6.1 Log-Überwachung

```bash
# Systemd
journalctl -u cernion -f | grep -E "ERROR|WARN|FATAL"

# PM2
pm2 logs cernion-energy-tools --lines 100 | grep -E "ERROR|WARN"
```

**Kritische Log-Muster** (Alert auslösen):
- `FATAL` — Anwendung nicht mehr funktionsfähig
- `LEVEL_LOCKED` — PouchDB von anderem Prozess gehalten
- `database is locked` — SQLite WAL-Konflikt
- `MCP session overflow` — Zu viele gleichzeitige Refreshes
- `Gemini API` + `5xx` — LLM-Backend nicht erreichbar

### 6.2 SQLite WAL-Größe überwachen

```bash
# WAL-Dateien > 100 MB = Warning; > 500 MB = Critical (Checkpoint blockiert)
find /opt/cernion-energy-tools/data/edm -name "*.wal" -o -name "*-wal" | \
  xargs du -sh 2>/dev/null

# Manueller WAL-Checkpoint (nur im gestoppten oder im Wartungsfenster)
sqlite3 /opt/cernion-energy-tools/data/edm/edm.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
```

### 6.3 PouchDB Dokumentenzahl

```bash
# Anzahl Dokumente im Object Store (indirekt über Datei-Anzahl im LevelDB-Log)
ls -la /opt/cernion-energy-tools/data/object-store/*.log 2>/dev/null | wc -l

# Oder via API (erfordert laufenden Dienst)
curl -s "http://localhost:3000/api/cya/profiles" | jq 'length'
```

### 6.4 Empfohlene Monitoring-Checks (Icinga/Prometheus/Zabbix)

| Check | Kommando / Endpoint | Threshold |
|-------|---------------------|-----------|
| API erreichbar | `curl -s -o/dev/null -w "%{http_code}" http://localhost:3000/api/cya/templates` | HTTP 200 |
| Prozess läuft | `systemctl is-active cernion` | `active` |
| Disk-Nutzung | `df -h /opt/cernion-energy-tools` | Warn >80%, Crit >90% |
| WAL-Größe | `find data/edm -name "*-wal" -size +100M` | leer = OK |
| RAM-Nutzung | `ps aux \| grep node` | < 1.5 GB RSS |

---

## 7. Updates / Versionswechsel

### 7.1 Standard-Update

```bash
# 1. CHANGELOG lesen
git log --oneline HEAD..origin/main
git show origin/main:CHANGELOG.md | head -50

# 2. Code aktualisieren
git pull origin main
git checkout v0.35.0   # gewünschte Version

# 3. Abhängigkeiten aktualisieren
npm install --omit=dev

# 4. Dienst neustarten
systemctl restart cernion

# 5. Smoke-Test
curl -s http://localhost:3000/api/cya/templates | jq '.length'
```

### 7.2 Datenbankmigrationen

In v0.34.0 sind **keine** Datenbankmigrationen erforderlich:
- **PouchDB** ist schema-less — neue Felder werden automatisch gelesen
- **SQLite EDM** nutzt keine `ALTER TABLE`-Migrationen — Partition-Dateien bleiben kompatibel

Vor jedem Update CHANGELOG prüfen ob `### Migration` Einträge vorhanden sind.

### 7.3 Rollback-Strategie

```bash
# 1. Dienst stoppen
systemctl stop cernion

# 2. Backup einspielen (siehe Abschnitt 5.3)

# 3. Alten Code wiederherstellen
git checkout v0.33.0
npm install --omit=dev

# 4. Dienst starten
systemctl start cernion
```

---

## 8. Fehlerbehebung (Troubleshooting)

### Service startet nicht

**Symptom:** `node index.js` endet sofort mit Exit-Code ≠ 0

```bash
# Ursache 1: Port bereits belegt
lsof -i :3000
kill -9 <PID>

# Ursache 2: Node.js-Version falsch
node --version   # muss >= 22.x sein

# Ursache 3: Abhängigkeiten fehlen
npm install

# Ursache 4: .env fehlt oder GEMINI_API_KEY leer
cat .env | grep GEMINI_API_KEY
```

### PouchDB-Fehler: `LEVEL_LOCKED`

**Ursache:** Ein anderer Prozess (z.B. eine zweite Instanz) hält das LevelDB-Lock.

```bash
# Prozesse die auf data/ zugreifen finden
lsof +D /opt/cernion-energy-tools/data/object-store/ | grep -v COMMAND
# Prozess beenden
kill <PID>
# Dienst neu starten
systemctl restart cernion
```

### SQLite: `database is locked`

**Ursache:** WAL-Modus ist nicht aktiv (sollte nicht vorkommen) oder parallele Writer.

```bash
# WAL-Status prüfen
sqlite3 data/edm/edm.sqlite3 "PRAGMA journal_mode;"
# Erwartete Ausgabe: wal
```

### MCP-Timeout: Analyse bricht ab

**Ursache:** Cernion MCP-Backend nicht erreichbar oder `CERNION_TOKEN` ungültig.

**Verhalten:** KRITIS-Fallback greift — deterministische Ergebnisse aus lokalem
MaStR-Cache werden zurückgegeben. Das System bleibt voll funktionsfähig.

```bash
# Token prüfen
grep CERNION_TOKEN .env

# Netzwerkverbindung prüfen
curl -s -o /dev/null -w "%{http_code}" https://cernion.de/health
```

### MQTT-Steuerbefehl nicht angekommen

**Ursache:** QoS 2-Mechanismus wartet auf Acknowledgement der Steuerbox.

1. Prüfen ob `mqttPublished: true` in der `/api/flex/execute`-Antwort
2. Steuerbox-Verbindung prüfen (MQTT-Subscriber aktiv?)
3. MQTT-Persistenz-Recovery (Abschnitt 5.4) wenn PouchDB korrupt

**QoS 2-Mechanismus:** Publish → PUBREC → PUBREL → PUBCOMP. Ohne PUBCOMP
wird die Nachricht nach Reconnect **genau einmal** erneut zugestellt (keine Duplikate).

### Analyse dauert länger als 30 Sekunden

Das System liefert bei langen Analysen ein async Job-Ergebnis (HTTP 202).
Den Status pollen:

```bash
JOB_ID="<jobId aus generate-Response>"
curl -s "http://localhost:3000/api/jobs/${JOB_ID}/status" | jq '.percent'
curl -s "http://localhost:3000/api/jobs/${JOB_ID}/result"
```

---

## 9. Sicherheit

### 9.1 Token-Manager (API-Zugriff absichern)

Alle schreibenden Endpunkte sind durch `ck_`-prefixed Bearer Tokens geschützt
(SHA-256 gespeichert, nie im Klartext). Scopes: `read-only` und `full-access`.

```bash
# Token erstellen (via API)
curl -s -X POST http://localhost:3000/api/token-manager/tokens \
  -H "Content-Type: application/json" \
  -d '{"scope": "full-access", "label": "Leitwarte-Client"}'
```

Alle nachfolgenden Requests:
```bash
curl -H "Authorization: Bearer ck_<token>" http://localhost:3000/api/cya/generate
```

### 9.2 Keine Credentials ins Repository committen

```bash
# .gitignore prüfen (sollte .env enthalten)
grep "\.env" .gitignore

# Sicherheitscheck
npm run audit:security:advisory
```

### 9.3 Nginx Reverse-Proxy (empfohlen)

Den API Gateway nie direkt exponieren. Empfohlene Minimal-Konfiguration:

```nginx
# /etc/nginx/sites-available/cernion
server {
    listen 80;
    server_name ihre-domain.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ihre-domain.example.com;

    ssl_certificate     /etc/letsencrypt/live/ihre-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ihre-domain.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=cernion:10m rate=30r/m;
    limit_req zone=cernion burst=10 nodelay;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 900s;   # Für lange CYA-Analysen
        proxy_send_timeout 900s;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

### 9.4 Netzwerk-Firewall (ufw)

```bash
# Nur HTTPS nach außen, API-Port nur lokal
ufw allow 22/tcp    # SSH
ufw allow 443/tcp   # HTTPS (via nginx)
ufw deny 3000/tcp   # API-Port nicht direkt exponieren
ufw enable
```

---

*Erstellt für Cernion Energy Tools v0.34.0 | Stand: 2026-04-29*
*Für Rückfragen: ops-team@cernion.de*
