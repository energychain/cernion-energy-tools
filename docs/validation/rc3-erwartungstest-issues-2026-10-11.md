# RC3-Erwartungstest — fertiger Issue-Text, 11.10.2026

Es wurde kein Issue angelegt. Der folgende Text betrifft den belegten ❌-Zugangsfall Z01, nicht einen nachgewiesenen Fehler in CETs Fachantworten. Die 27 fachlichen Prüffälle bleiben mangels erreichbaren Zugangs unbewertet.

## Z01: Bereitgestellter Testzugang wird vom Tenant-Gateway als nicht eingerichtet abgewiesen

### Ausgangslage

Im Produktionslauf `ET-2026-10-11-live-01` am 11.10.2026 um 18:14:31 UTC wurde die erste Fachfrage F01 über den freigegebenen OpenAI-kompatiblen Chat-Endpunkt an `https://api.cernion.de` gesendet. Verwendet wurden ausschließlich der bereitgestellte Gateway-Zugang und die angegebene Nutzer-ID von Person 1 für den vorgesehenen Tenant anthrophic. Token und Identitätsheader werden hier nicht veröffentlicht.

Die API antwortete mit **HTTP 403**:

> Für diesen Nutzer ist noch kein Zugang eingerichtet. Bitte wenden Sie sich an Ihre Administration.

Damit kann eine Fachanwenderin mit dem ausgelieferten Testzugang keine Fachfrage stellen. Der Test endete nach einer Chat-Anfrage, ohne Uploads, fachliche Testobjekte, alternative Identitäten oder Admin-Aufrufe. Die Antwort ist mit dem dokumentierten Fail-closed-Verhalten bei fehlendem Nutzer-Mapping vereinbar; die konkrete Ursache in Zuordnung oder Zugangsauslieferung ist ungeklärt.

### Erwartetes Verhalten

Vor der Übergabe eines Testzugangs sind Gateway-Organisation und beide persönlichen Open-WebUI-Zuordnungen für den vorgesehenen Tenant geprüft. Jede freigegebene Person kann mit ihrer bestehenden Zuordnung eine gewöhnliche Fachfrage stellen. Fehlende Zuordnungen sollen weiterhin verständlich und ohne fachliche Ausführung abgewiesen werden; ein persönlicher API-Token darf das Gateway-Mapping nicht ersetzen.

### Abnahme

- Die sicher konfigurierte Zuordnung von Person 1 und Person 2 ist jeweils über den vorgesehenen Gateway-Chatweg erreichbar; gewöhnliche Fachfragen liefern HTTP 200 und eine fachliche Antwort.
- Beide Identitäten gehören nachweislich zum vorgesehenen Tenant anthrophic; der Fachanwender-Test benötigt weder Admin-Aufrufe noch Identitätsraten.
- Eine nicht eingerichtete Person wird weiterhin mit HTTP 403 und verständlichem Hinweis abgewiesen.
- Der Erwartungstest kann anschließend seine Vorgangs-, Teamgedächtnis- und Dateiszenarien für beide Personen ausführen; alle bisherigen Chat-Anfragen werden auf das Gesamtbudget angerechnet.
- Belege für die erfolgreiche Zugangsauslieferung enthalten keine Token oder Identitätsheaderwerte.

Reproduktion: Mit den sicher hinterlegten Umgebungsvariablen den ersten katalogisierten Chat-Prüffall aus `scripts/validate-rc3-expectations-live.js` ausführen. Keine Wiederholung des unveränderten Zugangs nötig; der oben zitierte Produktionsbefund ist vorhanden.
