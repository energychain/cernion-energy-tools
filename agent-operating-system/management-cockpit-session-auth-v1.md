# Management-Cockpit Session-Authentifizierung v1

## Status und Geltungsbereich

AP 14 implementiert die Authentifizierung ausschließlich im isolierten Worktree. Es wurden keine produktiven Umgebungsvariablen, Reverse-Proxy-Regeln, Tokens, PM2-Prozesse oder Deployments verändert.

Die bestehende tokenisierte Cockpit-URL bleibt als Übergangsweg verwendbar. Der statische Token wird dabei nur noch bei einem navigierenden `GET /` oder `GET /management` als Session-Bootstrap akzeptiert. API-Aufrufe können sich nicht mehr über `?token=...` authentifizieren.

## Ablauf

1. Der vorhandene Link wird einmal für den Einstieg geöffnet.
2. Der Server vergleicht den Bootstrap-Token zeitkonstant.
3. Bei Erfolg erzeugt er eine signierte, kurzlebige Sitzung.
4. Die Antwort setzt ein Cookie mit `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` und begrenztem `Max-Age`.
5. Der Server antwortet mit HTTP 303 auf dieselbe URL ohne `token`-Parameter.
6. Die Browser-Clients führen zusätzlich `history.replaceState` aus, falls ein Token durch einen abweichenden Proxy-Ablauf doch noch in der geladenen URL steht.
7. Alle folgenden API-Aufrufe verwenden ausschließlich das Same-Origin-Session-Cookie.

Der Bootstrap-Token bleibt während der Übergangsphase ein wiederverwendbares Eintrittsgeheimnis. Er ist kein verbrauchbarer Einmalcode. Nach kontrollierter Aktivierung und Prüfung bestehender Zugangswege muss er separat rotiert werden.

## Session-Vertrag

- Standardlaufzeit: 30 Minuten.
- Konfigurierbar über `HITL_COCKPIT_SESSION_TTL_SECONDS`.
- Untergrenze: 60 Sekunden.
- Obergrenze: 8 Stunden.
- Signatur: HMAC-SHA-256 mit einem vom statischen Token abgeleiteten Schlüssel.
- Nutzlast: Versionsnummer, Ausstellungszeit, Ablaufzeit und kryptografischer Nonce.
- Manipulierte, abgelaufene, überlange oder nicht parsebare Sitzungen werden abgelehnt.
- Der Cookie enthält weder den statischen Bootstrap-Token noch Kanban- oder Managementdaten.
- Der Server hält keine Sessiondatenbank und keine produktive Persistenz vor.

Standard-Cookie:

```text
__Host-agentos_hitl_session=<signed-session>; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict
```

## Übergangs-Bearer

Statische Bearer-Authentifizierung ist standardmäßig deaktiviert. Für einen ausdrücklich geprüften Übergangsclient kann sie vorübergehend aktiviert werden:

```text
HITL_COCKPIT_ALLOW_LEGACY_BEARER=true
```

Diese Option erlaubt nur `Authorization: Bearer ...`. Sie reaktiviert keine Query-Token-Authentifizierung für APIs. Vor einer produktiven Aktivierung müssen reale API-Clients inventarisiert werden. Die Option soll nach der Migration wieder auf `false` stehen.

## Browser- und Header-Härtung

Jede Serverantwort erhält mindestens:

- `Cache-Control: no-store`
- `Content-Security-Policy` mit ausschließlich lokalen Skripten, Styles und Verbindungen
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- restriktive `Permissions-Policy`

HTML-Antworten erhalten zusätzlich HSTS. Die Seiten laden keine Drittressourcen. Das Legacy-Cockpit enthält sein CSS weiterhin inline; deshalb erlaubt die CSP für Styles vorerst `'unsafe-inline'`. Skripte bleiben auf `'self'` begrenzt.

`SameSite=Strict`, Same-Origin-Fetches und die fehlende Drittressourcen-/CORS-Freigabe begrenzen CSRF- und Referrer-Risiken. Das Secure-Cookie setzt für den realen Betrieb weiterhin HTTPS am Reverse Proxy voraus.

## Tokenhygiene

- Tokenwerte werden nicht in Client-JavaScript, HTML, API-Antworten, Session-Nutzlasten oder Dokumentation übernommen.
- Die Browser-Navigation zwischen Legacy- und Managementsicht enthält keine Tokenparameter mehr.
- APIs lehnen Query-Token auch dann ab, wenn der Wert korrekt ist.
- Serverstart- und Fehlerausgaben geben keine Authentifizierungswerte aus.
- Die erste Bootstrap-Anfrage kann den alten Token technisch noch in Reverse-Proxy-/Access-Logs transportieren. Vor Aktivierung sind deshalb Logformat, Aufbewahrung und Redaction am Proxy separat zu prüfen.
- Rotation des produktiven Tokens ist nicht Teil dieses Arbeitspakets und darf erst nach gesondertem Backup-, Impact- und Rollback-Schritt erfolgen.

## Konfiguration

```text
HITL_COCKPIT_TOKEN=<bootstrap-secret>
HITL_COCKPIT_SESSION_TTL_SECONDS=1800
HITL_COCKPIT_ALLOW_LEGACY_BEARER=false
```

Es wurde bewusst kein separates neues Secret eingeführt. Eine spätere Ausbaustufe kann einen unabhängigen Session-Signierschlüssel verwenden; dies erfordert dann einen eigenen Secret- und Rotationsvertrag.

## Aktivierung in einer späteren Betriebsfreigabe

1. Produktiven PM2-Prozess, CWD, Environment und Reverse-Proxy-Upstream read-only erneut prüfen.
2. Aktuelle Konfiguration sichern, ohne Secret-Werte in Bericht oder Shell-Historie auszugeben.
3. Inventarisieren, ob außer dem Browser Bearer-Clients existieren.
4. HTTPS, HSTS-Verträglichkeit und Proxy-Weitergabe von `Set-Cookie` prüfen.
5. Proxy-Access-Log auf Query-Redaction beziehungsweise kurze Aufbewahrung prüfen.
6. Neuen Code deployen, zunächst vorhandenen Link als Bootstrap nutzen.
7. Prüfen: HTTP 303 ohne Token in `Location`, Session-Cookie gesetzt, tokenfreie URL, API 200 mit Session, API 401 ohne Session.
8. Legacy- und Managementsicht sowie eine read-only API prüfen.
9. Erst nach bestätigter Übergangsphase den Bootstrap-Token separat rotieren.

## Rückfall

Ein Rollback besteht aus der Wiederherstellung der vorherigen Cockpit-Version und der vorherigen PM2-/Proxy-Konfiguration. Dieses Arbeitspaket ändert weder das Kanban-Schema noch die Managementprojektion. Session-Cookies der neuen Version werden von der alten Version ignoriert und laufen clientseitig aus.

Die temporäre Aktivierung von `HITL_COCKPIT_ALLOW_LEGACY_BEARER=true` ist kein Ersatz für einen Rollback und darf nicht dazu verwendet werden, Query-Token für APIs wieder einzuführen.

## Verifikation

Die fokussierten Tests decken ab:

- korrekten Bootstrap und tokenfreie Redirect-URL;
- gehärtete Cookie-Attribute;
- gültige, manipulierte und abgelaufene Sitzungen;
- API-401 ohne Session;
- Ablehnung korrekter Tokens in API-Queryparametern;
- standardmäßig deaktivierten Legacy-Bearer;
- optionalen, expliziten Bearer-Übergangsmodus;
- Security Header und fehlende Credential-Einbettung in Browser-Artefakten;
- unveränderte Legacy-Endpunkte und Legacy-Aktionen im expliziten Vertragsmodus.
