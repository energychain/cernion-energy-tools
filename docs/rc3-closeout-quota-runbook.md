# RC3: Kontingente dimensionieren und Live-Abnahme isolieren

CETs Mandantenkontingent und Anbieterlimits sind zwei getrennte Grenzen.
`LLM_QUOTA_EXCEEDED` bezeichnet das interne CET-Kontingent. Betriebsdiagnosen
melden `tenant_quota_exceeded`, Ressource und Resetzeit, ohne Anbieterstatus.
Ein tatsächliches HTTP 429 des Anbieters wird als `provider_quota` gemeldet.
Tagesfenster enden um 00:00 UTC; die Nutzeranzeige übersetzt den Resetzeitpunkt
nach Europe/Berlin (02:00 im Sommer, 01:00 im Winter). Monatsfenster enden am
Ersten des nächsten Monats um 00:00 UTC.

## Konfiguration je Tenant

`QUOTA_LLM_TOKENS_PER_DAY` (Standard 250.000) und
`QUOTA_LLM_TOKENS_PER_MONTH` (Standard 5.000.000) sind Vorgaben für neue
Tenant-Konfigurationen. Bestehende Overrides werden über die vorhandene
`tenant-quota.setQuotas`-API gepflegt. Die administrativen REST-Routen erfordern
die bestehenden Gateway-Rechte und die passende Tenant-Identität:

- `GET /api/tenants/<tenant>/quotas`: Nutzung, Grenze, Rest und Resetzeit.
- `PUT /api/tenants/<tenant>/quotas`: z. B. `quotas.llm_tokens_per_day`
  und `quotas.llm_tokens_per_month` ändern.
- `GET /api/tenants/<tenant>/rate-limit-events`: persistierte Warnungen.

In der Workbench können Tenant-Admins „Wie viel Kontingent ist heute noch übrig?“
fragen. Die Abfrage liest dieselbe API ohne Modell. Ab 80 % Tagesnutzung entsteht
pro Tenant und Tagesfenster ein dedupliziertes Ereignis und eine Betriebswarnung.
Tenant-Admins erhalten beim nächsten Kontakt einmalig einen Hinweis über
shared-service-notices; normale Nutzer erhalten keine Verbrauchsauskunft.
Eine Kontingentgrenze verhindert keine deterministischen Fall-/Gedächtnisabfragen
oder vorhandenen Datensatzabfragen. Neue Bewertungen benötigen wieder Kontingent.

## Tokens je Turn messen

Für einen repräsentativen synthetischen Korpus Nutzung vor/nach jedem Turn
über die Quota-API erfassen. Differenzen umfassen Verstehen, Antwort, Reparaturen,
Werkzeugplanung und Beziehungsprüfung. `estimatedUsed` und `actualUsed` getrennt
berichten: wenn die Fassade keine Provider-Tokenzahlen erhält, schätzt sie anhand
von Zeichen/4; solche Werte sind keine exakten Anbieterabrechnungen.

Messung vom 11.10.2026: Die bestandene RC3-Abnahme enthält elf Turns,
20 Modellaufrufe und 128.530 geschätzte Tokens. Acht Turns nutzten das Modell,
drei Gedächtnisabfragen/Widerrufe verbrauchten null Tokens. Gemessener Richtwert
für diesen Korpus: rund 16.066 Tokens je Modellturn; p95 (bei nur acht
Modellturns zugleich das Maximum) 30.006 Tokens. Über alle elf Turns beträgt
der Mittelwert 11.685 Tokens. Der Bericht `docs/validation/rc3-closeout-live.json`
enthält `tokenDelta` je Turn und trennt geschätzte von tatsächlichen Tokens.
Die kleine synthetische Stichprobe muss vor einer verbindlichen Dimensionierung
mit repräsentativen eigenen Abläufen erweitert werden.

Dimensionierung: Tagesgrenze = erwartete Modellturns/Tag × gemessene p95-Tokens/Turn
× Reserve (z. B. 1,3); Monatsgrenze analog mit erwarteten Arbeitstagen und
Hintergrundprüfungen. Für 100 Modellturns ergibt der gemessene Korpus als
Planungsansatz 100 × 30.006 × 1,3 = rund 3.901.000 Tokens/Tag. Der Standard
250.000 reicht beim gemessenen Mittelwert für etwa 15 Modellturns; Reparaturen,
weitere Beziehungsprüfungen und Hintergrundarbeit verringern diesen Spielraum.

Ein Neustart ist kein Kontingent-Resetverfahren. Der vorhandene Schalter
`RESET_LLM_TOKENS_PER_DAY_ON_RESTART` sollte bei verbindlicher Tagesbudgetierung
`false` sein. Konfiguration bestehender Tenant-Overrides prüfen, bevor nur
Umgebungsvariablen erhöht werden.

## Begrenzte Live-Abnahme

Alle Live-Validatoren installieren `scripts/live-validation-budget.js`:
separater synthetischer Test-Tenant, isoliertes Quota-Verzeichnis, zentrale
LLM-Fassade, ein Backendversuch je Aufruf, kein strukturierter Fallback nach 429.
`LIVE_MAX_MODEL_CALLS` (Standard 40) und `LIVE_MAX_TOKENS` (Standard 1.000.000)
begrenzen den Lauf. Nach 429 oder Aufrufgrenze sind weitere Aufrufe gesperrt.
Der Abschlussbericht nennt versuchte/erfolgreiche Aufrufe und Tokenverbrauch;
`LIVE_BUDGET_REPORT` schreibt zusätzlich eine JSON-Datei. Modellnamen werden
nicht in diesen Bericht übernommen. Produktive Quota-Verzeichnisse und Tenants
werden auch bei fehlender oder falscher Tenant-Option nicht verwendet.

Zuerst genau eine Probe ausführen, nicht wiederholen:

```bash
WORKBENCH_ENV_FILE=/secure/path/.env LIVE_MAX_MODEL_CALLS=1 \
  node scripts/validate-rc3-closeout-live.js --probe
```

Nur nach erfolgreicher Probe die Abnahme separat starten:

```bash
WORKBENCH_ENV_FILE=/secure/path/.env LIVE_MAX_MODEL_CALLS=40 LIVE_MAX_TOKENS=1000000 \
  node scripts/validate-rc3-closeout-live.js
```

Der Lauf prüft neun synthetische Thread-Nachrichten, Einzelkundengespräch,
Charly/Doris in beiden Reihenfolgen mit frischen Ankern, sofortige Verbindung,
Neuigkeiten, einmalige Abfrage beider Aussagen und Widerruf im Altdatenformat
in einem neuen Chat. Bei 429 oder fehlgeschlagener Abnahme bleibt der PR offen;
kein Merge und kein Deployment.
