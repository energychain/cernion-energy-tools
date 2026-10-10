# Portfolio-Forecast: Implementierungsstand nach dem abgebrochenen Backtest

Fortgeschrieben am 26.09.2026 auf Nutzerauftrag: alle technischen Voraussetzungen
vor dem nächsten Volltest umsetzen. Bedienung und Beispiele:
[REST-Prognosen und Wiederaufnahme](forecast-portfolio-live-and-resume.md).
Methodik: [07:00-Portfolio-Backtest](forecast-portfolio-0700.md).

## Ausgangslage und Absturzbefund

Der Elf-Dateien-Lauf `5536fa2a-4bd2-4cc6-8dde-79bbb6f055ba` für
01.01.2023–31.12.2024 endete nach 8041/8041 berechneten Zählertagen ohne
persistiertes Ergebnis. Die alte Version hatte keine Block-Checkpoints.
Diese bereits verlorene Berechnung lässt sich nicht nachträglich wiederherstellen.

Die Nachprüfung des PM2-Fehlerlogs ergab unmittelbar vor dem Neustart um
12:10 UTC `RangeError: Invalid string length` in
`node:internal/readline/interface` beim Aufbau einer Worker-Ausgabezeile.
Damit ist für diesen Vorfall eine konkrete Ursache belegt: die zu große
zusammenhängende Ergebnisnachricht. Ein allgemeiner OOM-Befund wird daraus nicht
abgeleitet.

## Umgesetzt

- [x] **Wiederaufnahme und Ergebnissicherung:** Atomare, prüfsummengeschützte
  28-Tage-Blöcke enthalten Prognosen, Auswahlbelege und Ausfallszenarien.
  Resume prüft Eingaben/Konfiguration/Code/Bibliotheken; fertige Blöcke werden
  wiederverwendet. Persistierte Originalanfragen und Ergebnismanifeste überleben
  den Job-TTL und Prozessneustarts. Ergebnisdateien werden je Zähler geschrieben
  und gestreamt, statt ein Gesamtobjekt durch Node zu übertragen. Worker-Nachrichten
  sind zusätzlich größenbegrenzt. Dateisperren verhindern parallele Fits desselben
  Laufs; Linux-Worker enden auch beim harten Tod ihres Brokerprozesses.
- [x] **Client-Wiederverbindung:** `--resume` mit neuem Ausgabeordner,
  Eingabehash-Prüfung, Wiederverwendung der Dataset-IDs und Abruf fertiger Ergebnisse.
  GET-Verbindungsfehler werden begrenzt wiederholt; keine blinden POST-Wiederholungen.
  Neustarts mit `recovery_pending` werden durch explizites Run-Resume behandelt.
  Archive enthalten Skripte, Client-Abhängigkeiten, Konfiguration und HTTP-Belege.
- [x] **Auswertung bereitgestellt:** Kandidatenfehler, Auswahlhäufigkeit,
  RMSE-Gewinn gegen die Vorwoche, saisonale Fehler, Null-/Aktivitätsfehler,
  Tagesmengen, Peaks und Ausfalltests im Bericht. Die fachliche Erstbewertung des vollständigen neuen Elf-Dateien-Laufs liegt
  jetzt in der verlinkten Ergebnisanalyse vor.
- [x] **Fortgeschriebene Zählerhistorie:** Mandant/Series-ID, inkrementelle Deltas,
  Raster-/Einheits-/Zeitzonenprüfung, expliziter Erstimport vorhandener Dataset-IDs,
  Deduplizierung und versionierte Korrekturen. Live-Lieferungen werden nicht vor
  ihren Eingang zurückdatiert. Historische Erstimporte kennzeichnen die Annahme
  „nächster Tagesbeginn“, falls Lieferzeiten fehlen. Historienversionen bleiben
  explizit adressierbar; fehlende Werte bleiben fehlend.
- [x] **Persistente Modelle:** Native globale/lokale/zweistufige CatBoost-Modelle
  und konstante Modelle; Skalierung, Niedrigverbrauchsschwellen, Feature-Vertrag,
  Trainingsgrenzen, Auswahlbelege, Historienversionen, Bibliotheks-/Codeversionen
  und Prüfsummen. Laden ohne Pickle; Mandantentrennung und Kompatibilitätsprüfung.
- [x] **Einsatztraining:** Separater `/train`-Pfad mit derselben historischen
  Kandidatenauswahl. Neue unveränderliche Modellversion; keine automatische
  Aktivierung durch Backtests. Zu alte Trainingsdaten werden für einen aktuellen
  Ursprung abgewiesen. Aktuelle Daten müssen vor einem realen Einsatz eingespielt
  werden; die vorhandenen Daten bis 2024 ersetzen diese nicht.
- [x] **REST-Prognose:** `/predict` mit Series-ID, Modellversion, Zieldatum und
  optionalen neuen Messungen; alternativ explizite Historienversion. Keine
  vollständige erneute Datenübertragung nötig. Neue Daten ändern Features,
  nicht automatisch Modellparameter. Einzelprognose benötigt nur Zählerhistorie.
- [x] **Informationsgrenzen/Antwort:** Gemeinsamer Feature-Code mit Backtest,
  07:00/D−2, revisionsgerechte Verfügbarkeit, DST, Viertelstundenwerte,
  Tagesenergie, Modell-/Historienversion, Kandidat, Informationsursprung,
  tatsächlicher Erstellungszeitpunkt, Datenstand, Ersatzprofil und Warnungen.
- [x] **Modellaktualisierung:** 28-Tage-Fälligkeit und `/retrain` mit aktuellen
  Historien aller bisherigen Mitglieder. Neuer expliziter Versionsbezug;
  vorherige Versionen bleiben erhalten. Veraltete Modelle werden standardmäßig
  abgewiesen, auf ausdrücklichen Wunsch mit Warnung verwendet. Die betriebliche
  Zeitsteuerung ruft den Endpunkt auf; kein automatischer Versionswechsel.
- [x] **Betrieb/Tests/Dokumentation:** Gezielte Node-/Python-Tests, echter isolierter
  HTTP-Neustarttest mit SIGKILL, Checkpoint-Wiederaufnahme, Modell-Wiederladen,
  Korrekturverfügbarkeit, Streaming-Ergebnisabruf sowie Client-Resume/Replay.
  REST-Verträge, OpenAPI und Betriebsanleitung ergänzt.

## Noch vom nächsten Lauf beziehungsweise Einsatz abhängig

- [x] Neuer vollständiger Elf-Dateien-Backtest und fachliche Erstbewertung:
  [Ergebnisanalyse vom 26.09.2026](forecast-portfolio-results-20260926.md).
  Vollständige Abdeckung; kein allgemeiner Qualitätsgewinn gegenüber dem alten
  System belegt. Ein fairer E2-Vergleich unter demselben 07:00-Vertrag bleibt offen.
- [ ] Für den echten Einsatz aktuelle Messdaten einspielen, Einsatzmodell
  trainieren und die zu verwendende Version im aufrufenden Betrieb festlegen.
  Zeitsteuerung für Datenlieferung/Neutraining dort konfigurieren.

Gemeinsames und individuelles Modell bleiben alternative Kandidaten je Zähler,
keine Kombination aus Grundmodell und Korrekturmodell. Intraday-Prognosen gehören
nicht zum vereinbarten Tagesprognosevertrag. Technischer Abschluss bedeutet keine
automatische Produktivfreigabe oder Gütegarantie.

## Neue fachliche Arbeitspakete aus dem E2-Vergleich

Die technische Umsetzung oben ist abgeschlossen; die folgenden Qualitätsarbeiten
sind nachfolgend mit ihrem v2-Status aufgeführt. Details und nachgerechnete Belege:
[E2/E4-Ursachenanalyse und Optimierungsplan](forecast-portfolio-e2-optimization-plan.md).

- [x] E4-Metriken aus sämtlichen Einzelprognosen nachrechnen; Vollzeitraum und Q4
  getrennt exportieren. Alle elf Reihen stimmen mit dem bestehenden Bericht überein.
- [ ] E2-Zeitstempel, DST, D−3-Verfügbarkeit und eingefrorenen Trainingsstand abgleichen.
- [x] Verfügbarkeits-/Feature-Vertrag versionieren; E2-Features und Zweiwochenreferenz ergänzen.
- [x] MAE-basierte Auswahl und Bestätigung gegen einfache Referenzen implementieren.
- [x] Lokalen HGB-Kandidaten und validierte Wochenmischungen ergänzen.
- [x] Nullmodell-/Loss-Kandidaten implementieren; empirische Ablation bleibt beim nächsten Lauf.
- [ ] Optional Profilgruppen nach der Routing-Ablation prüfen.
- [x] Neue Verträge/Kandidaten in Persistenz, REST, Resume und Regressionstests integrieren.
- [ ] Unabhängige Qualitätsbestätigung auf bisher ungenutztem Zeitraum durchführen.

## Fortschreibung: v2 implementiert

Die oben neu aufgenommenen Implementierungsarbeiten sind durch
[Portfolio v2](forecast-portfolio-v2.md) konkretisiert:

- [x] Versionierter D−3/D−2-Vertrag, rollierender/eingefrorener Vergleich und E2-Features.
- [x] MAE-Routing mit unabhängiger Bestätigung und Block-Bootstrap gegen Referenzen.
- [x] Zweiwochenreferenz, lokaler HGB, 75/25-Wochenmischung sowie MAE-/Hurdle-Gate-Kandidaten.
- [x] Backtest-/Live-Vertrag, Modellpersistenz, Neutraining und Resume-Versionierung.
- [x] Timestamp-Export, unabhängige Fehlersummen und gepaarter Vergleich als mitkopiertes Skript.
- [x] Gezielte Tests für D−3, Auswahl, Modell-Roundtrip, eingefrorenen Resume und Export.
- [ ] Externe E2-Prognosen/Code erhalten und exakt abgleichen; fehlende Angaben werden nicht erfunden.
- [ ] Ablationen/Volltest und unabhängigen Qualitätsnachweis durchführen.
- [ ] Optional nach Routing-Ablation Profilcluster prüfen; nicht Bestandteil der Standard-v2.

Der neue Code allein belegt keine Verbesserung auf WAPE <70 %.


## Zustandsanalyse und v3 vom 27.09.2026

- [x] Binäre Klassifikation und Mengenfehler für 3/8/10/11 getrennt auswerten.
- [x] Lokale Null-/Grundlast-/Aktivmodelle als zusätzliche validierte Kandidaten.
- [x] Nullreferenz, Mengenunterdeckung und getrennte Zustandsdiagnosen sichtbar machen.
- [x] Persistenz, REST, Retraining, D−3-Prüfungen und Regressions-/HTTP-Tests.
- [x] Identischer Winter-/Sommer-Pilot: Auswahlgewinn bei 10 im Sommer, sonst unverändert.
- [ ] Vollständiger Elf-Dateien-Lauf und unabhängige Qualitätsbestätigung.

Details und verbleibende Grenzen: [Zustandsfehleranalyse und v3](forecast-portfolio-state-error-analysis-20260927.md).

## Produktpfad mit gemeinsamem Referenzbestand (27.09.2026)

Implementiert: `shared_baseline`-Training mit 1–16 eigenen Zählern, gemeinsame versionierte
Evidenz aus erfolgreichen Produkttrainings, private Modellzuordnung pro Tenant/Zähler,
credential-gebundene Live-API und Job-Abfragen, optionale Blindleistung/Profile mit
Verfügbarkeitsgrenzen, Kernkandidat ohne Zusatzdaten und vorläufiger Einstieg ab 28 Tagen.
Contract und Einführung: [forecast-product-contract.md](forecast-product-contract.md).

Offen bleibt der unabhängige Qualitätsnachweis dieses neuen Produktverfahrens. Die elf
Portfolio-Testreihen und ihre bisherigen WAPE-Werte belegen ihn nicht. Produktionsdaten
werden nicht automatisch importiert und vorhandene Modelle nicht automatisch aktiviert.

### Ergänzung 2026-09-27: versionierter Instanztransfer

Umgesetzt: Offline-Export/Verify/Import des vollständigen Forecast-Runtime-Speichers mit
Formatversion, SHA-256-Inventar, Code-/Dependency-Prüfung, nativen Modellladeprüfungen,
Vergleichsprognosen und unveränderten Tenant-Bindungen. Neue Zielverzeichnisse werden erst
nach erfolgreicher Prüfung veröffentlicht. Basismodelle und Referenzhistorien bleiben für
weiteres Training nutzbar. Runbook: [forecast-model-transfer.md](forecast-model-transfer.md).
Nicht Teil von V1: Live-Migration, Zusammenführen vorhandener Instanzen, Tenant-Teilimporte,
automatische Modellformat-Upgrades oder Token-Übertragung.

### Ergänzung 2026-09-27: öffentliches Startmodell

Implementiert: separater Core-Export ohne Historien/IDs, Ed25519-signiertes Releaseformat,
konfigurierbarer HTTPS-Erstbezug mit SHA-256-/Signatur-/Kompatibilitätsprüfung, Offline-Import
und lokale chronologische Auswahl des öffentlichen Modells als zusätzlicher Kandidat.
Das öffentliche Modell benötigt auf der Zielinstanz keine ursprünglichen Referenzhistorien.
Private Anpassungen und lokale Referenzevidenz bleiben tenantgeschützt innerhalb der Instanz.
Runbook: [forecast-public-starter.md](forecast-public-starter.md).
Offene Betreiberentscheidungen: freigegebene Modelllizenz, öffentliche Release-URL, langlebiger
Signierschlüssel und vertrauenswürdige Verteilung des öffentlichen Schlüssels. Keine automatische
Veröffentlichung, kein automatischer Modellwechsel und kein Rückkanal für Kundendaten.

### Ergänzung 2026-09-27: erweiterte Trainingsdaten aufbereitet

CSV-Zählerzusammenführung, Deduplizierung, UTC-/Registerprüfung, W→kWh und getrennte Bezugs-/
Einspeisereihen sind umgesetzt. Der Offline-Herausgeberlauf kann ältere Reihen als Referenzen
neben aktuellen eigenen Zählern nutzen, ohne Live-Datenfristen zu lockern. 17 reale Serien
wurden vorbereitet und für beide Richtungen kausal vorab geprüft. Der vollständige Lauf
kann über `train_prepared.py` gestartet werden; noch nicht durchgeführt.
Runbook: [forecast-basis-training-data.md](forecast-basis-training-data.md).
Noch offen bleibt eine produktweite Messrichtungs-Auswahl für öffentliche Startmodelle;
Einspeisemodelle werden bis dahin nicht als Verbrauchs-Starter veröffentlicht.

### Ergänzung 2026-09-27: direkte Basismodell-Qualität und saisonale Zusammensetzung

Umgesetzt und vollständig ausgeführt: neuer Standardmodus `train_prepared.py --mode baseline`
mit vollständigen Historien als Auswahlgrundlage, gleichen Zähler-/Saison-/Jahresgewichten,
global kausalen saisonalen Validierungsfenstern für alle 17 Serien und direkter Prüfung des
gemeinsamen Core-Modells ohne lokale Gewinner. Vorgängermodus bleibt unter `--mode adaptation`.
Berichte, Einzelprognosen und unabhängig nachgerechnete Metriken/Gewichte liegen im neuen
Stand `tmp/profile/basis_training_models_20260927_v2`. Öffentlicher Export ist an den
gebundenen Qualitätsbericht gekoppelt; kein automatisches Publizieren. Keine Änderung des
Live-Engine-Fingerprints. Details und verbleibende fachliche Befunde:
[forecast-baseline-quality.md](forecast-baseline-quality.md).
