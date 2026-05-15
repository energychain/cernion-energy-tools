# Architektur- & Implementierungsplan: Cernion Public Chat UI

**Datum:** 2026-05-15
**Status:** In Planung
**Ziel:** Schaffung eines minimalistischen, öffentlichen Chat-Interfaces zur Lead-Generierung auf `cernion.de` durch das Verstecken energiewirtschaftlicher Komplexität hinter einem simplen Prompt.

## 1. Use Case & Lead Generation
Die Chat-UI wird primär als B2C/B2B2C Einstiegspunkt (Free-Tier) positioniert. 
- **Erste Interaktion:** Nutzer können sofort eine energiewirtschaftliche Frage stellen (z.B. zu Netzanschluss, Redispatch, Tarifen). Die UI gibt die erste Antwort vollständig und kostenlos aus.
- **Lead-Gen Trigger:** Nach dieser ersten Antwort friert die Chat-UI den Eingabebereich ein. Es erscheint ein Modal oder Overlay mit dem Wording: *"Zum Schutz und Speichern Ihrer Chat-Session."*
- **Conversion:** Der Nutzer wird aufgefordert, sich kurz zu registrieren (E-Mail/Passwort oder SSO), um den Chat fortzusetzen. Die Registrierung erzeugt im Hintergrund den formalen Mandanten (Tenant).

## 2. Datenmodell & Identität
- **Anonymer Start:** Ein neuer, nicht-eingeloggter Session-Besucher erhält im Hintergrund eine anonyme, temporäre Session-ID. 
- **Personal Agent Binding:** Jeder Session wird initial eine isolierte, temporäre Tenant-ID zugewiesen, an die ein `Personal Agent` gebunden wird.
- **Claiming:** Sobald der Nutzer sich registriert, wird die temporäre Tenant-ID in eine permanente Kunden-Tenant-ID überführt und die Conversation History der ersten Frage bleibt erhalten.

## 3. Architektur: Die Chat-Middleware
Um CORS-Probleme zu vermeiden und eine saubere Trennung zwischen Frontend und Backend zu gewährleisten, wird eine dedizierte Node.js/Express-Middleware (BFF - Backend for Frontend) etabliert.
- **Frontend-Domain:** `cernion.de/chat` (oder Sub-Domain).
- **Middleware / Proxy:** Dient als API-Gateway für das Frontend. Hält Rate-Limits für unangemeldete Sessions und übernimmt die Session-Cookie Verwaltung.
- **Backend-Target:** Die Middleware reicht Requests sicher an die interne Cernion API unter `http://10.0.0.5:3900/` weiter. 
- **Externe API-Repräsentation:** Falls Entwickler direkt auf die API zugreifen wollen, wird diese logisch unter `https://api.cernion.de/` geführt.

## 4. API-Schnittstelle (Backend-Anbindung)
Die gesamte Kommunikation der Chat-UI (via Middleware) beschränkt sich auf den in v0.52 implementierten Microservice des Personal Agents.
- **Endpunkt:** `POST /api/personal-agent/chat`
- **Kontext:** Nutzt L0-L4 Zwiebelmodus. Die Chat-UI verlässt sich zu 100% auf die Backend-Logik, ohne eigene Fachprozesse zu implementieren. Die UI rendert lediglich `agentText`, `interface-placeholder` und `fileProcessing` Artefakte.
- **File-Uploads (v0.52.9):** Der Endpunkt unterstützt `multipart/form-data` für künftige Inhouse-Data-Features.

## 5. Design & User Experience (UX)
Das Leitmotiv lautet: *"Wir verstecken die absolute Komplexität der Energiewirtschaft hinter einem einzigen Chat-Prompt."*
- **Minimalismus extrem:** Noch reduzierter als ChatGPT. Keine Seitenleiste im Free-Tier, keine überladenen "Suggested Prompts" Boxen.
- **White Space:** Massive Nutzung von negativer Fläche (White Space). Die Konzentration liegt ausschließlich auf dem Chat-Flow.
- **Branding:** Oben fixiert findet sich ausschließlich das Cernion-Logo und der Schriftzug (exakt wie auf `cernion.de`).
- **Farbklima:** Strenge Einhaltung der Cernion-Corporate-Identity. 
  - Hintergrund: Clean Slate / Weiß (`#f8fafc`, `#ffffff`).
  - Akzente: Cernion Türkis/Emeraude (`#10b981`) und Trust-Blau (`#2563eb`) für den User-Bubble oder interaktive Elemente.
  - Typografie: Klare, moderne Sans-Serif-Schriften mit hohem Kontrast für exzellente Lesbarkeit.
