# Architektur- und Implementierungsplan: Cernion Public Chat-UI

**Projekt:** Öffentliches Cernion Chat-Interface für cernion.de (B2C / Lead-Generierung)
**Target URL:** `https://chat.cernion.de` (Vorschlag) oder `https://cernion.de/chat`
**Version:** v1.0.0
**Scope:** UI + Middleware-Architektur, Spec-First
**Anbindung:** Personal Agent Microservice (v0.52+)

---

## 1. Zusammenfassung (Executive Summary)

Wir bauen ein öffentlich zugängliches, hochmodernes Chat-Interface für cernion.de. Die Nutzung ist primär **kostenlos**. Nach der **ersten** generierten Antwort wird der Chat eingefroren – der Nutzer wird zum Login / zur Registrierung aufgefordert. Das Framing gegenüber dem Nutzer: *„Zum Schutz und Speichern Ihrer Chat-Session“*. Ziel ist Lead-Generierung für den Cernion-B2C-Bereich.

Die Architektur besteht aus zwei Hauptkomponenten:
1. **Frontend (Chat-UI)** – Ein reactives SPA, extrem minimalistisch, mit maximaler visueller Reduktion.
2. **Middleware (Proxy)** – Ein schlanker Node.js-Proxy-Service, der CORS-Probleme vermeidet und die interne Cernion-API (`http://10.0.0.5:3900/`) kapselt.

---

## 2. Use Case & Lead-Generierung

### 2.1 User Journey (B2C)

| Phase | UI-Zustand | Aktion | Datenmodell |
|-------|-----------|--------|-------------|
| **1. Landing** | Großes, zentriertes Eingabefeld, leere Seite | Nutzer tippt erste Frage | Kein Account, `x-tenant-id: public` |
| **2. Erste Antwort** | Streaming-Response, Assistenz-Message | Personal Agent beantwortet mit L0-L3-Stack | Session-ID generiert, Layer 4 transient |
| **3. Freeze** | Inputfeld deaktiviert, Frost-Overlay | Nach der ersten Antwort wird der Chat eingefroren | Session gespeichert (layer2/layer3) |
| **4. Registrierung** | Modal/Overlay „Zum Schutz und Speichern" | Nutzer kann Account erstellen oder einloggen | Neuer Account → neuer Tenant-ID, Session-Migration |
| **5. Freischaltung** | Input wieder aktiv, Verlauf erhalten | Chat geht nahtlos weiter mit persistierter Session | Session tenant-übergreifend migriert |

### 2.2 Lead-Gen Framing

Die Sperre wird **niemals** als Paywall oder Limit dargestellt. Die Kommunikation ist immer:

> **„Zum Schutz und Speichern Ihrer Chat-Session erstellen Sie bitte einen kostenlosen Account. So können Sie Ihre Analyse später fortsetzen und auf allen Geräten abrufen."**

Das schafft:
- Psychologischen Wert (Schutz, Persistenz, Multi-Device)
- Kein Reibungsverlust durch „kostenlos / Premium"
- Natürliche E-Mail-Erfassung für Marketing-Automation

### 2.3 Session-Migration (Pre- → Post-Auth)

**Problem:** Die „erste kostenlose Antwort" läuft unter `tenant-id: public`. Nach Auth hat der Nutzer eine eigene Tenant-ID.

**Lösung:**
1. Session wird anfangs mit einer generischen `public`-Tenant-ID angelegt.
2. Nach erfolgreicher Registrierung/Login wird via Middleware die Session migriert:
   ```json
   {
     "oldSessionId": "pa_pub_xxx",
     "newTenantId": "tenant-evu-uuid-v4",
     "newUserId": "user-uuid-v4",
     "migrateLayer2": false,
     "migrateLayer3": true
   }
   ```
3. Der Personal Agent klonen Layer 3 (Chat-Verlauf) in den neuen Tenant-Namespace.
4. Layer 2 (Profil) wird für den neuen Nutzer neu initialisiert (da Pre-Auth-Profil = leer).

---

## 3. Design & UX-Spezifikation

### 3.1 Design-Prinzipien

| # | Prinzip | Umsetzung |
|---|---------|-----------|
| 1 | **Ultra-Minimalismus** | Weniger UI-Elemente als ChatGPT. Keine Seitenleiste, kein Drawer, kein Settings-Panel, kein Theme-Switcher |
| 2 | **Weiße Fläche als First-Class** | Startbildschirm ist 90% leer. Nur Eingabefeld + Logo |
| 3 | **Eine Aufgabe, eine Fläche** | Keine Ablenkung. Der Chat *ist* das Interface |
| 4 | **Cernion-Brand-Konsistenz** | Farben, Typografie, Abstände strikt analog cernion.de |
| 5 | **Sichtbare Leichtigkeit** | Schrift, Abstände, Animationen vermitteln: „Energiewirtschaft ist komplex – wir machen sie einfach" |

### 3.2 Branding & Farbwahl (analog cernion.de)

Die Farben werden exakt aus dem cernion.de-Designsystem übernommen:

| Token | Hex | Verwendung |
|-------|-----|------------|
| `--color-bg-primary` | `#ffffff` | Haupt-Hintergrund |
| `--color-bg-surface` | `#f8fafc` | Alternativer Hintergrund (Slate-50), z.B. Code-Blöcke, Eingabefeld |
| `--color-bg-muted` | `#f1f5f9` | Hover-States, subtile Trenner (Slate-100) |
| `--color-border` | `#e2e8f0` | Trennlinien, Input-Rahmen (Slate-200) |
| `--color-text-primary` | `#0f172a` | Haupttext, Logo, Überschriften (Slate-900) |
| `--color-text-secondary` | `#64748b` | Sekundärer Text, Zeitstempel (Slate-500) |
| `--color-text-tertiary` | `#94a3b8` | Placeholder, deaktiviert (Slate-400) |
| `--color-accent` | `#10b981` | Primärer Akzent, CTA-Buttons, aktive Indikatoren, Streaming-Cursor (Emerald-500) |
| `--color-accent-hover` | `#059669` | Akzent-Hover (Emerald-600) |
| `--color-accent-secondary` | `#2563eb` | Links, sekundäre CTAs (Blue-600) |
| `--color-error` | `#dc2626` | Fehlermeldungen (Red-600) |

**Hinweis:** Keine zusätzlichen Farben, kein dunkler Modus, kein bunter Chat-Verlauf.

### 3.3 Top-Navigation (Fixed)

```
┌─────────────────────────────────────────────────────────────┐
│  ◆ Cernion                [Login]  [Kostenlos starten]      │
└─────────────────────────────────────────────────────────────┘
```

- **Links:** Logo-Mark (◆ Emerald-Diamond) + Wortmarke „Cernion" in Slate-900, Schrift aus cernion.de-Fontstack (Inter / Geist / System)
- **Rechts:** Zwei Links – „Login" (Text, Secondary) und „Kostenlos starten" (Button/Pill, Emerald)
- **Höhe:** 48px oder 56px
- **Rahmen:** 1px Bottom-Border `#e2e8f0`
- **Transparenz:** Nur bei Top-of-Page transparent mit Blur-Backdrop, nach Scroll solid white

### 3.4 Eingabefeld (Hero-Modus)

Beim ersten Laden (keine Nachrichten):

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                                                             │
│                                                             │
│              ◆                                              │
│           CERNION                                           │
│                                                             │
│   Was möchten Sie über Ihre Energiesituation wissen?        │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Z. B.: "Wie viel Strom verbraucht ein DHH...       │   │
│   │                                                   [➤]│   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│              Kostenlos. Keine Kreditkarte nötig.            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Zentriert** vertikal und horizontal
- **Logogrösse:** 40px Mark + Wortmarke in Slate-900
- **Sub-Heading:** „Was möchten Sie über Ihre Energiesituation wissen?" in Slate-500, 16px, font-weight 400
- **Input-Feld:**
  - Breite: max 720px, padding 20px vertical, 24px horizontal
  - Hintergrund: `#f8fafc`
  - Border: 1px `#e2e8f0`, Radius 16px (very soft)
  - Focus-State: Border-Color wechselt zu `#10b981`, subtiler Shadow (`0 0 0 3px rgba(16,185,129,0.15)`)
  - Placeholder: „Z. B.: Wie viel Strom verbraucht ein Doppelhaushälfte im Jahr?"
  - Send-Button (innerhalb Input rechts): Emerald-Kreis mit weissem Pfeil
- **Trust-Line:** „Kostenlos. Keine Kreditkarte nötig." – Slate-400, 12px, zentriert unter Input

### 3.5 Chat-Verlauf (Nach erster Eingabe)

Nach dem ersten Prompt:
- Hero-Layout verschwindet (fade out, 200ms)
- Logo-Mark wandert an die Top-Nav (klein, 24px)
- Chat-Stream erscheint
- Eingabefeld dockt an den unteren Rand (wie ChatGPT)

**Message-Bubbles-Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  ◆ Cernion                                        [Login]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────┐                       │
│  │  Wie viel Strom verbraucht...    │  user-msg              │
│  └──────────────────────────────────┘                       │
│                                                             │
│                       ┌─────────────────────────────────┐   │
│                       │  Ein durchschnittlicher...      │   │
│                       │  [Zusammenfassung mit Quellen]  │   │
│                       └─────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ❄️  Zum Schutz und Speichern Ihrer Chat-Session   │   │
│  │      erstellen Sie bitte einen kostenlosen Account. │   │
│  │                                                     │   │
│  │      [📝 Account erstellen (kostenlos)]             │   │
│  │      [🔐 Bereits registriert? Einloggen]            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Z. B.: Wie kann ich meinen Stromverbrauch...       ➤│  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**User-Nachrichten:**
- Links ausgerichtet
- Hintergrund: `#f8fafc`
- Text: `#0f172a`, Slate-900
- Radius: 16px oben-rechts, oben-links, unten-rechts = 16px, unten-links = 4px
- Max-Breite: 80%
- Padding: 14px 18px

**Assistent-Nachrichten:**
- Rechts ausgerichtet
- Hintergrund: `#ffffff` (kein Hintergrund – reiner Text auf weiss)
- Text: `#0f172a`, Line-Height 1.7
- Kein Radius (kein „Bubble"-Gefühl), stattdessen ein feiner Linker Border 2px `#e2e8f0` bei längeren Antworten
- Quellen/Hinweise unter der Antwort in Slate-400, 12px

**Freeze-Overlay / Registration Prompt:**
- Input-Feld wird `disabled`, Opacity 0.5
- Darüber ein weiches Overlay mit Info-Message
- Hintergrund des Overlays: `rgba(248,250,252,0.95)` mit Backdrop-Blur
- Icon: Shield / Lock in `#10b981`
- CTA-Button: „Account erstellen (kostenlos)" – Emerald-Filled, 44px hoch, Radius 8px
- Sekundär-Link: „Bereits registriert? Einloggen" – Text-Link in `#2563eb`

### 3.6 Typografie

| Element | Font | Weight | Size | Line-Height | Color |
|---------|------|--------|------|-------------|-------|
| Logo | Inter / Geist | 700 | 20px | 1.2 | `#0f172a` |
| Hero-Headline | Inter / Geist | 600 | 20px | 1.3 | `#0f172a` |
| Hero-Subline | Inter / Geist | 400 | 16px | 1.5 | `#64748b` |
| User-Message | Inter | 400 | 15px | 1.6 | `#0f172a` |
| Assistant-Message | Inter | 400 | 15px | 1.7 | `#0f172a` |
| System-Hinweis | Inter | 500 | 14px | 1.5 | `#64748b` |
| CTA-Button | Inter | 600 | 14px | 1 | `#ffffff` |
| Timestamps | Inter | 400 | 11px | 1 | `#94a3b8` |

---

## 4. Datenmodell

### 4.1 Pre-Auth Nutzer (Public Session)

```json
{
  "session": {
    "sessionId": "pa_pub_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8",
    "tenantId": "public",
    "userId": null,
    "authState": "anonymous",
    "createdAt": "2026-05-15T09:00:00.000Z",
    "lastActivityAt": "2026-05-15T09:02:00.000Z"
  },
  "l3": {
    "history": [
      { "role": "user", "text": "Wie viel Strom verbraucht ein Doppelhaus?", "ts": "2026-05-15T09:00:12.000Z" },
      { "role": "assistant", "text": "...", "ts": "2026-05-15T09:00:45.000Z" }
    ],
    "compressed": false
  }
}
```

### 4.2 Post-Auth Nutzer (Migrierte Session)

```json
{
  "session": {
    "sessionId": "pa_evuxxx_b1c2d3e4-f5g6-4790-b123-c4d5e6f7a9b0",
    "tenantId": "tenant-evu-uuid-v4",
    "userId": "user-uuid-v4",
    "authState": "authenticated",
    "personalAgentId": "pa-user-uuid-v4",
    "createdAt": "2026-05-15T09:00:00.000Z",
    "migratedAt": "2026-05-15T09:03:00.000Z",
    "originalSessionId": "pa_pub_a1b2c3d4-..."
  },
  "l2": {
    "userProfile": {
      "defaults": {},
      "preferences": {},
      "onboardingState": "pending"
    }
  },
  "l3": {
    "history": [
      { "role": "user", "text": "Wie viel Strom verbraucht ein Doppelhaus?", "ts": "2026-05-15T09:00:12.000Z" },
      { "role": "assistant", "text": "...", "ts": "2026-05-15T09:00:45.000Z" }
    ],
    "compressed": false
  }
}
```

### 4.3 Lead-Datenstruktur

```json
{
  "leadId": "lead_uuid",
  "source": "public-chat-ui",
  "capturedAt": "2026-05-15T09:00:45.000Z",
  "initialPrompt": "Wie viel Strom verbraucht ein Doppelhaus?",
  "firstResponseSummary": "Durchschnittlicher Doppelhaushälfte: 3500 kWh/a...",
  "sessionId": "pa_pub_...",
  "migratedToUserId": null,
  "convertedAt": null,
  "conversionStatus": "pending"
}
```

---

## 5. Architektur

### 5.1 Komponentendiagramm

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                           INTERNET (HTTPS / 443)                             │
│                                                                              │
│   ┌─────────────────┐    ┌──────────────────────┐    ┌───────────────────┐   │
│   │   Browser (Nutzer)  │    │   chat.cernion.de     │    │  api.cernion.de     │   │
│   │                   │    │   (Next.js / Svelte)   │    │  (API Gateway)      │   │
│   └────────┬──────────┘    └──────────┬───────────┘    └─────────┬─────────┘   │
│            │                           │                        │            │
│            │  HTTPS / WSS              │  HTTPS (internal)       │            │
│            │                           ▼                        │            │
│            │              ┌───────────────────────────┐        │            │
│            │              │  Public Chat Middleware   │        │            │
│            │              │  (Node.js / Express)      │        │            │
│            │              │  chat-middleware.cernion  │        │            │
│            │              │  .de  (Port 3000/8080)    │        │            │
│            │              └────────────┬──────────────┘        │            │
│            │                           │ HTTP (privates Netz)   │            │
│            │                           ▼                       │            │
│            │              ┌───────────────────────────┐        │            │
│            └─────────────►│  Cernion API Gateway      │◄───────┘            │
│                           │  api.service.js           │                     │
│                           │  http://10.0.0.5:3900/    │                     │
│                           └────────────┬──────────────┘                     │
│                                        │ Moleculer Bus                      │
│                                        ▼                                    │
│                           ┌───────────────────────────┐                     │
│                           │  Personal Agent Service   │                     │
│                           │  personal-agent.service.js│                     │
│                           │  (v0.52+)                 │                     │
│                           └────────────┬──────────────┘                     │
│                                        │ ctx.call                           │
│                           ┌────────────┼──────────────┐                     │
│                           ▼            ▼              ▼                     │
│                     ┌──────────┐ ┌──────────┐  ┌──────────┐                │
│                     │Capability│ │  L0-L2   │  │  L3/L4   │                │
│                     │ Broker   │ │ QDrant   │  │ Redis    │                │
│                     └──────────┘ └──────────┘  └──────────┘                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Layer-Definition

| Layer | Komponente | Zuständigkeit |
|-------|-----------|---------------|
| **L7 (Presentation)** | Chat-UI SPA | Reactives UI, State-Management, Streaming-Render, Auth-Modal |
| **L6 (Proxy)** | Public Chat Middleware | CORS-Proxy, Request-Routing, Tenant-Mapping, Auth-Pre-Flight, Rate-Limiting |
| **L5 (API Gateway)** | `api.service.js` (Cernion) | REST-Konvertierung, OpenAPI, Auth, Tenant-Resolve |
| **L4 (Orchestration)** | `personal-agent.service.js` | Context Stack (L0-L4), Capability-Routing, Execution |
| **L3 (Backend)** | 82 Moleculer Services | Fachliche Domänen-Logik |
| **L2 (Persistence)** | QDrant + Redis | Layer 1/2 (QDrant), Layer 3 (Redis + File) |

---

## 6. Middleware-Spezifikation

### 6.1 Warum eine eigene Middleware?

- **CORS:** Browser verhindern direkte Calls von `chat.cernion.de` → `api.cernion.de` (unterschiedliche Subdomains)
- **Tenant-Mapping:** Pre-Auth nutzt `tenant-id: public`. Post-Auth Nutzer bekommen echte Tenant-IDs. Die Middleware hält diesen Zustand.
- **Rate-Limiting:** Öffentliche Endpunkte brauchen Schutz vor Abuse (z.B. 10 Req/Min pro IP für anonyme Nutzer)
- **Lead-Capture:** Die Middleware speichert das erste Prompt/Response-Paar als Lead, bevor Auth stattfindet
- **No CORS-Config im Gateway:** Das Cernion-API-Gateway soll keine öffentliche CORS-Konfiguration tragen (Security)

### 6.2 Middleware – Neue Moleculer-Service oder Standalone?

**Empfehlung: Standalone Express-App** (kein Moleculer-Service).

Begründung:
- Die Middleware ist **keine fachliche Domäne**. Sie ist reine Infrastruktur.
- Separate Deploy-Einheit ermöglicht unabhängiges Scaling (mehr Frontend-Last → mehr Middleware-Instanzen, ohne Backend-Cluster zu belasten)
- Keine Moleculer-Transporter-Abhängigkeit → simpler, robuster
- Kann auf einem Edge-Node (CDN-Worker, Vercel Edge, etc.) laufen

**Alternative (wenn gewünscht):** Neuer Moleculer-Service `public-chat-gateway`. Dies würde aber den Moleculer-Bus belasten und ist für Pure-Proxy-Aufgaben overkill.

### 6.3 Middleware – API-Endpunkte

| Methode | Route | Zweck | Auth |
|---------|-------|-------|------|
| `POST` | `/v1/chat` | Chat-Turn an Personal Agent | Optional (x-public-session-id Header) |
| `GET` | `/v1/session/:sessionId` | Session-Status abrufen | Optional |
| `POST` | `/v1/session/:sessionId/reset` | Session zurücksetzen | Optional |
| `POST` | `/v1/auth/register` | Registrierung + Session-Migration | Body (email, password) |
| `POST` | `/v1/auth/login` | Login + Session-Claim | Body (email, password) |
| `GET` | `/v1/auth/session` | Aktuelle Auth-Session prüfen | Cookie/Token |
| `POST` | `/v1/lead/capture` | Lead manuell capturieren (intern) | API-Key |

### 6.4 Middleware – Request/Response Mapping

**POST /v1/chat (Pre-Auth / Anonym)**

Request:
```json
{
  "message": "Wie viel Strom verbraucht ein Doppelhaus?",
  "sessionId": "pa_pub_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8"
}
```

Middleware → Cernion API:
```json
POST http://10.0.0.5:3900/api/personal-agent/chat
Headers:
  Content-Type: application/json
  x-tenant-id: public
  x-public-session: true
Body:
{
  "message": "Wie viel Strom verbraucht ein Doppelhaus?",
  "sessionId": "pa_pub_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8",
  "executionMode": "auto",
  "knownContext": {}
}
```

Response (an UI):
```json
{
  "success": true,
  "sessionId": "pa_pub_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8",
  "reply": "Ein durchschnittlicher Doppelhaushälfte verbraucht etwa 3.500 kWh Strom pro Jahr...",
  "layer4Purged": true,
  "routing": { ... },
  "plan": { ... },
  "execution": { ... },
  "requiresAuth": true,
  "authPrompt": {
    "title": "Session schützen",
    "message": "Zum Schutz und Speichern Ihrer Chat-Session erstellen Sie bitte einen kostenlosen Account.",
    "actions": [
      { "label": "Account erstellen", "action": "register", "style": "primary" },
      { "label": "Einloggen", "action": "login", "style": "secondary" }
    ]
  }
}
```

Die Middleware fügt `requiresAuth: true` hinzu, wenn die Session mehr als 1 Antwort enthält.

### 6.5 Middleware – Session-Migration Flow

```sequence
UI          Middleware    Cernion API (auth)    Cernion API (personal-agent)
 |               |                  |                  |
 |  POST /auth/register           |                  |
 |  { email, pw, sessionId }      |                  |
 |───────────────►|               |                  |
 |               │  POST /api/auth/register          |
 |               │───────────────►|                  |
 |               │               │  Tenant + User    |
 |               │◄───────────────│  created          |
 |               │  { tenantId, userId, token }      |
 |               │                |                  |
 |               │  POST /api/personal-agent/chat    |
 |               │  { message: "", action: "migrateSession",  }  |
 |               │  Headers: x-tenant-id: <new>      |
 |               │───────────────►───────────────────►|
 |               │                |   internal-agent  |
 |               │                |   clones L3       |
 |               │◄───────────────┼───────────────────│
 |               │  { migrated: true, newSessionId }  |
 |               │                |                  |
 |◄──────────────│  { token, newSessionId, tenantId }|
 |  (Cookies set)|                |                  |
```

### 6.6 Middleware – Rate Limiting

| Phase | Limit | Key |
|-------|-------|-----|
| Anonym (Pre-Auth) | 1 Chat-Turn / Session | `sessionId` |
| Anonym (IP-based) | 10 Requests / 60 Min | `req.ip + '::public-chat'` |
| Authentifiziert | 60 Chat-Turns / 60 Min | `userId` |
| Auth-Endpunkte | 5 Versuche / 15 Min | `req.ip` |

Implementierung: `express-rate-limit` mit Redis-Store (shared across instances).

### 6.7 Middleware – Lead Capture

Die Middleware speichert bei **jeder ersten anonymen Antwort** ein Lead-Dokument:

```javascript
// Pseudocode
async function captureLead(sessionId, prompt, responseSummary) {
  await leadStore.create({
    leadId: generateUUID(),
    source: 'public-chat-ui',
    capturedAt: new Date().toISOString(),
    initialPrompt: prompt,
    firstResponseSummary: responseSummary.substring(0, 500),
    sessionId,
    ipHash: hashIp(req.ip), // GDPR-konform, nicht der reale IP
    userAgentFingerprint: hash(req.headers['user-agent']),
    convertedAt: null,
    conversionStatus: 'pending',
  });
}
```

Storage: Einfache JSON-Files oder SQLite (im MVP), später Migration zu `crm.service.js` oder `customer-service.service.js`.

---

## 7. Frontend-Spezifikation

### 7.1 Technologie-Stack

| Schicht | Technologie | Begründung |
|---------|-------------|------------|
| Framework | **Next.js 14+** (App Router) oder **SvelteKit** | SSR-fähig, schnelles First-Contentful-Paint, Edge-Deployment auf Vercel möglich |
| Styling | **Tailwind CSS** | Design-System-Token einfach abbildbar, kein Runtime-Overhead |
| State | **Zustand** oder **Jotai** | Minimal, keine Redux-Komplexität nötig |
| Streaming | **Native Fetch + ReadableStream** | Keine SSE-Library nötig, Personal Agent liefert derzeit kein Streaming → Polling oder WebSocket optional |
| Auth | **NextAuth.js** (Next.js) oder **Lucia** (SvelteKit) | OAuth2, Magic Link, Credentials |
| Icons | **Lucide React** | Leicht, konsistent, guter tree-shaking |
| Animation | **Framer Motion** | Für Hero-zu-Chat-Transition (Fade, Layout-Shift) |

### 7.2 Komponenten-Struktur (Next.js App Router)

```
app/
├── page.tsx                    # Landing / Chat-Page (Server Component)
├── layout.tsx                  # Root Layout (Fonts, Metadata, Providers)
├── globals.css                 # Tailwind + Custom Properties
├── api/
│   └── chat/
│       └── route.ts            # Server-Side Route Handler → Middleware
│   └── auth/
│       └── [...nextauth]/      # NextAuth.js Konfiguration
├── components/
│   ├── ChatInterface.tsx       # Haupt-Chat-Container (Client)
│   ├── HeroInput.tsx           # Zentriertes Eingabefeld (initial)
│   ├── ChatInput.tsx           # Docked Eingabefeld (post-first-message)
│   ├── MessageBubble.tsx       # User / Assistant Nachricht
│   ├── FreezeOverlay.tsx       # Auth-Prompt Overlay
│   ├── AuthModal.tsx           # Login / Register Modal
│   ├── TopNav.tsx              # Fixe Top-Navigation
│   └── Logo.tsx                # Cernion Logo-Mark + Wordmark
├── hooks/
│   ├── useChat.ts              # Chat-State, API-Calls, Session-Handling
│   ├── useSession.ts           # Session-Restore, Reset
│   └── useAuth.ts              # Auth-State, Session-Migration
├── lib/
│   ├── api-client.ts           # Typed Fetch-Wrapper zur Middleware
│   ├── session-store.ts        # localStorage Session-ID Persistenz
│   └── constants.ts            # Farben, Limits, Endpoints
└── types/
    ├── chat.ts                 # Message, Session, API-Response Typen
    └── auth.ts                 # User, Lead Typen
```

### 7.3 State-Management

```typescript
// Zustand-Store (vereinfacht)
interface ChatState {
  // Session
  sessionId: string | null;
  authState: 'anonymous' | 'authenticating' | 'authenticated';
  tenantId: string | null;
  userId: string | null;

  // Messages
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: object;
  }>;

  // UI-State
  isLoading: boolean;
  isFrozen: boolean;
  hasStarted: boolean; // true nach erstem Prompt
  showAuthModal: boolean;

  // Actions
  sendMessage: (text: string) => Promise<void>;
  restoreSession: (sessionId: string) => Promise<void>;
  migrateSession: (email: string, password: string) => Promise<void>;
  resetSession: () => void;
}
```

### 7.4 Session-Persistenz im Browser

- **Session-ID** wird in `localStorage` unter `cernion_chat_session_id` gespeichert
- **Tenant-ID + User-ID + Token** werden sicher in `httpOnly` Cookies von der Middleware gesetzt (nicht im Browser-JS lesbar)
- Bei Page-Reload:
  1. Frontend liest `localStorage` Session-ID
  2. Ruft `GET /v1/session/:id` auf
  3. Wenn `authState === 'authenticated'` → setzt Auth-Cookies, zeigt Chat
  4. Wenn `authState === 'anonymous'` → zeigt Hero mit Freeze-Overlay falls History > 1 Msg

### 7.5 Streaming-Verhalten

Der Personal Agent (v0.52) liefert aktuell **kein Streaming** (kein SSE/WebSocket für Token-by-Token). Die Response kommt als komplettes JSON.

**MVP-Ansatz:**
- UI zeigt „Denkt nach..." mit pulsendem Emerald-Dot während des API-Calls
- Nach Erhalt der Response wird der Text mit einer Typing-Animation (30ms/Char bis 500ms total) eingeblendet
- Das gibt trotz fehlendem Backend-Streaming ein flüssiges Gefühl

**Future (optional):**
- Personal Agent erweitern um SSE-Support (`text/event-stream`)
- Middleware proxyt SSE 1:1
- UI nutzt `EventSource` für echtes Streaming

---

## 8. API-Schnittstelle (Personal Agent)

### 8.1 Verwendete Endpunkte

Die Chat-UI kommuniziert **ausschließlich** mit dem Personal Agent Microservice. Keine direkten Calls an andere Cernion-Services.

| Moleculer Action | REST-Path (via API Gateway) | Nutzung in UI |
|------------------|---------------------------|---------------|
| `personal-agent.chat` | `POST /api/personal-agent/chat` | Jeder Chat-Turn |
| `personal-agent.getSession` | `GET /api/personal-agent/session/:sessionId` | Session-Restore nach Reload |
| `personal-agent.resetSession` | `POST /api/personal-agent/session/:sessionId/reset` | „Neuer Chat" Button |
| *(neu)* `personal-agent.migrateSession` | `POST /api/personal-agent/session/migrate` | Tenant-Übergang bei Auth |

### 8.2 Neue Personal Agent Action: `migrateSession`

*Hinweis: Diese Action ist **optional** für den MVP. Alternativ kann die Middleware eine neue Session mit `knownContext` erstellen und den L3-Verlauf als `knownContext` übergeben.*

```javascript
// Parameter-Schema
{
  sourceSessionId: { type: 'string', required: true },
  targetTenantId: { type: 'string', required: true },
  targetUserId: { type: 'string', required: true },
  migrateLayer3: { type: 'boolean', default: true },
  migrateLayer2: { type: 'boolean', default: false },
}

// Response
{
  success: true,
  newSessionId: 'pa_evuxxx_...',
  migratedMessages: 2,
  message: 'Session erfolgreich migriert.'
}
```

Die Action:
1. Holt L3-History der `sourceSessionId` (aus `public` Namespace)
2. Erstellt neue Session im `targetTenantId` Namespace
3. Kopiert L3-History in neue Session
4. Optional: Initialisiert L2 mit Default-Onboarding-Fragen
5. Löscht **nicht** die alte Public-Session (für Lead-Tracking)

---

## 9. Implementierungsplan

### Phase 1: Infrastructure & Scaffolding (Tag 1-2)

| # | Task | Deliverable |
|---|------|-------------|
| 1.1 | Repository anlegen: `energychain/cernion-public-chat-ui` | GitHub-Repo mit README, LICENSE (GPL-3.0) |
| 1.2 | **Middleware** Scaffolding: Express-App mit TypeScript, ESLint, Prettier | `middleware/` Ordner, ping-Endpunkt |
| 1.3 | **Frontend** Scaffolding: Next.js 15 + Tailwind + TypeScript | `frontend/` Ordner, running dev server |
| 1.4 | Design-Token in Tailwind konfigurieren (`tailwind.config.ts`) | cernion.de Farben als Custom Properties |
| 1.5 | Middleware → Cernion Health-Check (`GET http://10.0.0.5:3900/` ) | `proxy-check` Endpoint |

### Phase 2: Core Chat (Tag 2-4)

| # | Task | Deliverable |
|---|------|-------------|
| 2.1 | Hero-Input Komponente bauen | `HeroInput.tsx` |
| 2.2 | Chat-MessageRendering (User + Assistant) | `MessageBubble.tsx`, `ChatInterface.tsx` |
| 2.3 | Middleware-Proxy: `POST /v1/chat` → `personal-agent.chat` | Funktionierender Chat-Turn |
| 2.4 | Session-Management im Frontend (localStorage, Restore) | `useChat.ts`, `useSession.ts` |
| 2.5 | „Denkt nach" Animation während API-Call | Loader-Komponente |
| 2.6 | Session Reset (Neuer Chat) | `resetSession` Handler |

### Phase 3: Lead-Gen Freeze (Tag 4-5)

| # | Task | Deliverable |
|---|------|-------------|
| 3.1 | Freeze-Overlay Komponente mit Trust-Message | `FreezeOverlay.tsx` |
| 3.2 | Input-Disabled-State nach erster Antwort | `isFrozen` Logik in Store |
| 3.3 | Middleware: `requiresAuth` Flag nach 1. Turn | Response-Enrichment |
| 3.4 | Lead-Capture auf Middleware-Ebene | SQLite/JSON Lead-Store |
| 3.5 | Auth-Modal (UI-Only, keine echte Auth) | `AuthModal.tsx` mit Register/Login Tabs |

### Phase 4: Auth & Session-Migration (Tag 5-7)

| # | Task | Deliverable |
|---|------|-------------|
| 4.1 | Registrierungs-Endpunkt (Middleware → Cernion Auth) | `POST /v1/auth/register` |
| 4.2 | Login-Endpunkt (Middleware → Cernion Auth) | `POST /v1/auth/login` |
| 4.3 | JWT/Cookie-Handling in Middleware | `httpOnly` Secure Cookies |
| 4.4 | Session-Migration auf Personal Agent (optional) | `migrateSession` Action oder Middleware-L3-Clone |
| 4.5 | Auth-State in Frontend (Cookies lesen, Session prüfen) | `useAuth.ts` |
| 4.6 | Post-Auth: Input freischalten, Verlauf beibehalten | `migrateSession` Flow |

### Phase 5: Polish & Deploy (Tag 7-8)

| # | Task | Deliverable |
|---|------|-------------|
| 5.1 | Mobile-Responsiveness (iPhone, Android, Tablet) | Breakpoints: sm, md, lg |
| 5.2 | Accessibility (ARIA, Keyboard-Navigation, Focus-Trapping im Modal) | a11y Audit |
| 5.3 | Meta-Tags, OG-Image, Favicon | SEO-Basics |
| 5.4 | Middleware-Rate-Limiting konfigurieren | `express-rate-limit` + Redis |
| 5.5 | Error-Handling (API down, Timeout, 500) | Error-Boundary + Retry-UI |
| 5.6 | Deploy: Frontend → Vercel, Middleware → VPS / Docker | Prod-URLs |

---

## 10. MVP-Scope (In / Out)

**In (MVP):**
- [ ] Hero-Chat auf reinweißem Hintergrund
- [ ] Erste Frage beantworten (Personal Agent `chat`)
- [ ] Freeze nach erster Antwort mit Auth-Prompt
- [ ] Registrierung/Login (Email + Passwort)
- [ ] Session-Wiederherstellung nach Reload
- [ ] Lead-Capture (Prompt + Antwort-Summary)
- [ ] Mobile-Responsive
- [ ] Middleware-Proxy + Rate-Limiting

**Out (Post-MVP):**
- [ ] OAuth (Google, LinkedIn)
- [ ] Echtes Streaming (SSE)
- [ ] Magic-Link-Login
- [ ] Multi-Session-Verlauf (Sidebar mit Sessions)
- [ ] Sharing von Chat-Sessions (Link)
- [ ] Onboarding-Fragen im Chat
- [ ] Voice-Input (Speech-to-Text)
- [ ] Dark Mode
- [ ] Mehrsprachigkeit (DE/EN)

---

## 11. Testplan

### 11.1 Unit-Tests (Frontend)

| Test-ID | Beschreibung |
|---------|-------------|
| F-UT-001 | `HeroInput` rendert korrekt, Placeholder sichtbar |
| F-UT-002 | `MessageBubble` rendert User- und Assistant-Message korrekt |
| F-UT-003 | `FreezeOverlay` zeigt sich, wenn `isFrozen === true` |
| F-UT-004 | `useChat.sendMessage` fügt Message hinzu + setzt `isLoading` |
| F-UT-005 | `useSession.restoreSession` lädt Session aus localStorage |

### 11.2 Integrationstests (Middleware)

| Test-ID | Beschreibung |
|---------|-------------|
| M-IT-001 | `POST /v1/chat` mit gültigem Payload → 200 + `sessionId` |
| M-IT-002 | `POST /v1/chat` ohne `message` → 400 Validation Error |
| M-IT-003 | `POST /v1/chat` anonym nach 1. Turn → `requiresAuth: true` |
| M-IT-004 | Rate-Limit: 11. Request in 60s → 429 Too Many Requests |
| M-IT-005 | `POST /v1/auth/register` → Account erstellt + Session migriert |
| M-IT-006 | `POST /v1/auth/login` → Token-Set, Session-Claim |

### 11.3 End-to-End (E2E)

| Test-ID | Beschreibung |
|---------|-------------|
| E2E-001 | Nutzer öffnet Seite → sieht Hero → tippt Frage → sieht Antwort → sieht Freeze |
| E2E-002 | Nutzer registriert sich → Input wird freigeschaltet → Chat geht weiter |
| E2E-003 | Nutzer reloadet Seite → Session wiederhergestellt → Verlauf sichtbar |
| E2E-004 | Nutzer auf Mobile: gleiche Journey, Touch-Input funktioniert |
| E2E-005 | API-Gateway down → Fehlermeldung „Bitte versuchen Sie es später" |

---

## 12. Risikoanalyse

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| **R01: Abuse der kostenlosen Anfrage** | Mittel | Hoch | IP-basiertes Rate-Limiting, reCAPTCHA v3 invisible vor erster Anfrage |
| **R02: Nutzer verlässt Seite vor Auth (Bounce)** | Hoch | Hoch | Exit-Intent-Modal: „Möchten Sie Ihre Session speichern?", Email-Capture-Zwischenschritt |
| **R03: Session-Migration verliert Kontext** | Niedrig | Hoch | L3-Verlauf wird atomisch kopiert, kein Overwrite; Rollback möglich |
| **R04: Cernion API nicht erreichbar** | Niedrig | Kritisch | Circuit-Breaker in Middleware, Graceful-Degradation: „Cernion ist vorübergehend nicht verfügbar" |
| **R05: Lead-Daten DSGVO-Konformität** | Mittel | Hoch | Keine personenbezogenen Daten in Leads (nur Prompt, keine IP, nur Hash), DSGVO-Hinweis im UI |
| **R06: Design zu puristisch (Nutzer versteht nicht, was zu tun ist)** | Mittel | Mittel | Klarer Placeholder-Text, Tutorial-Tooltip beim ersten Besuch (optional) |
| **R07: Auth-Service in Cernion Backend noch nicht vorhanden** | Mittel | Kritisch | Fallback: Middleware hat eigenen JWT-Auth mit SQLite-User-Store, Migration nach Cernion-Auth später |
| **R08: Personal Agent `chat` Latenz >5s** | Mittel | Mittel | Optimistisches UI (Immediate User-Message), Skeleton-Loader, Latenz-Hinweis |

---

## 13. Offene Entscheidungen

| # | Entscheidung | Status | Options |
|---|-------------|--------|---------|
| D01 | **Frontend-Framework:** Next.js vs. SvelteKit? | **Offen** | Next.js (Community, SSR), SvelteKit (Performance, weniger Komplexität) |
| D02 | **Middleware-Hosting:** Standalone Node.js vs. Moleculer-Service? | **Empfohlen: Standalone** | Standalone (flexibler) vs. Moleculer (Konsistenz mit Cernion) |
| D03 | **Auth-Provider:** Eigene Auth vs. Cernion `auth.service.js`? | **Offen** | Cernion Auth (wenn OAuth/JWT existiert) vs. Middleware-eigene Auth (schneller) |
| D04 | **Session-Migration:** Neue Action `migrateSession` vs. Middleware-Clone? | **Offen** | Action (clean, Atomic) vs. Middleware (kein Backend-Change nötig) |
| D05 | **Domain:** `chat.cernion.de` vs. `cernion.de/chat`? | **Offen** | Subdomain (cleaner, unabhängiges Deploy) vs. Subpath (SEO, gleiche Domain) |
| D06 | **Lead-Storage:** SQLite/JSON vs. Cernion CRM-Service? | **Offen** | SQLite (MVP) vs. CRM-Service (Integration nötig) |
| D07 | **reCAPTCHA:** v2 Checkbox vs. v3 invisible? | **Empfohlen: v3** | v3 (keine User-Reibung) vs. v2 (explizit, höhere Sicherheit) |

---

## 14. Appendices

### Appendix A: UI Wireframes (ASCII)

**Landing (Empty State):**
```
+---------------------------------------------------------------+
| [◆ Cernion]                                    [Login]        |
+---------------------------------------------------------------+
|                                                               |
|                                                               |
|                                                               |
|                          ◆                                    |
|                       CERNION                                 |
|                                                               |
|        Was moechen Sie ueber Ihre Energiesituation wissen?    |
|                                                               |
|    +-----------------------------------------------------+    |
|    |  Z. B.: Wie viel Strom verbraucht eine DHH...    [➤]|    |
|    +-----------------------------------------------------+    |
|                                                               |
|              Kostenlos. Keine Kreditkarte noetig.             |
|                                                               |
+---------------------------------------------------------------+
```

**Active Chat (Frozen):**
```
+---------------------------------------------------------------+
| [◆ Cernion]                                    [Login]        |
+---------------------------------------------------------------+
|                                                               |
|  +----------------------------------+                         |
|  |  Wie viel Strom verbraucht...   |  <- User (slate bg)     |
|  +----------------------------------+                         |
|                                                               |
|                         +----------------------------------+  |
|                         |  Ein Doppelhaus verbraucht ca...|  |
|                         |  ...durchschnittlich 3.500 kWh. |  |
|                         +----------------------------------+  |
|                                                               |
|  +--------------------------------------------------------+  |
|  |  [Shield] Zum Schutz Ihrer Session:                    |  |
|  |      Erstellen Sie einen kostenlosen Account           |  |
|  |                                                          |  |
|  |      [ Account erstellen (kostenlos) ]  [ Einloggen ]   |  |
|  +--------------------------------------------------------+  |
|                                                               |
|  +--------------------------------------------------------+  |
|  |  Weitere Frage stellen...      [disabled]              |  |
|  +--------------------------------------------------------+  |
+---------------------------------------------------------------+
```

### Appendix B: Environment Variablen (Middleware)

```bash
# API
CERNION_API_URL=http://10.0.0.5:3900
CERNION_API_KEY=                      # Falls API-Key Auth erforderlich

# Server
PORT=3000
NODE_ENV=production

# Auth
JWT_SECRET=<random-256-bit-secret>
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=.cernion.de
COOKIE_SECURE=true
COOKIE_SAME_SITE=strict

# Rate Limiting
RATE_LIMIT_ANONYMOUS=10  # per 60 min
RATE_LIMIT_AUTHENTICATED=60  # per 60 min
REDIS_URL=redis://10.0.0.5:6379

# Lead Capture
LEAD_STORAGE_PATH=./data/leads
LEAD_MAX_PROMPT_LENGTH=1000

# reCAPTCHA
RECAPTCHA_SECRET_KEY=<google-secret>
RECAPTCHA_SITE_KEY=<google-site-key>
```

### Appendix C: Environment Variablen (Frontend)

```bash
NEXT_PUBLIC_MIDDLEWARE_URL=https://chat-middleware.cernion.de/v1
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=<google-site-key>
```

---

## 15. Aenderungen im Cernion Backend (Abhängigkeiten)

| # | Änderung | Status | Notizen |
|---|---------|--------|---------|
| C01 | Personal Agent `chat` akzeptiert `tenant-id: public` | **Prüfen** | Das `public`-Tenant muss in `getTenantId(ctx)` validiert werden (kein Schema-Constraint, das `public` ablehnt) |
| C02 | Neue Action `personal-agent.migrateSession` | **Optional** | Nur wenn Middleware keinen L3-Clone selbst macht. Alternative: Frontend übergibt L3-Historie als `knownContext` bei neuer Session |
| C03 | Auth-Service (`auth.service.js`) muss Register/Login per REST bieten | **Prüfen** | Existiert bereits? Wenn nicht, Middleware braucht eigenen Auth-Store |
| C04 | `api.service.js` Route für `personal-agent` muss anonyme Requests zulassen | **Prüfen** | Ohne validen JWT/Auth-Header? Dies wäre ein Security-Risiko, daher nur via internem Middleware-Call |

---

*Dokument erstellt: 2026-05-15*
*Autor: Hermes Agent*
*Kontext: Entwicklungsbegleiter für Cernion Energy Tools*
