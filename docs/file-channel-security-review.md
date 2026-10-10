# Security-Review: Dateikanal #790

Reviewumfang: `/v1/files`, `/v1/files/{fileId}/content`, `/link`, DELETE,
Open-WebUI-Filter/Downloadproxy, geschützte Broker-Actions, Object-Store-Zugriff und
Dokument-/Dataset-Weiterverarbeitung. Risiko: HIGH, da Originaldateien einen neuen
Ein-/Ausgangskanal bilden. Kein Deployment ist Teil dieser Änderung.

| Prüffeld | Umsetzung / Nachweis |
| --- | --- |
| Authentifizierung | Bestehender `/v1`-Facade-Auth-Pfad und `token-manager.verify`; kein zusätzlicher Schlüsseltyp oder Rollenmodell. |
| Gateway-Delegation | `workbench.resolveTurnPrincipal` prüft Token-Tenant/Client/Org, aktive Nutzerzuordnung, Rollen und Clearance und persistiert Delegationsaudit. Ungemappter Nutzer/falsche Org erhalten 403. |
| Tenant-Isolation | Speicher-Namespace wird ausschließlich aus dem authentifizierten Tenant abgeleitet. Datei-IDs und signierte Tickets können keinen anderen Namespace auswählen. |
| Vertraulichkeit | Original-Level wird bis Evidence und #774 übernommen; Export übernimmt alle nötigen Quellfreigaben. Jeder Abruf prüft aktuelle Clearance erneut. Identische Bytes mit anderer Klassifikation werden abgewiesen. |
| Object-Store-Umgehung | `files:*` und `files_audit:*` sind durch interne Symbol-Capability geschützt; generische Object-Store-Endpunkte können weder Bytes noch Audit lesen/schreiben/löschen. |
| Downloadtickets | HMAC-SHA256, konstanter Signaturvergleich, Tenant/File/Version/Expiry signiert, sieben Tage Laufzeit. Ticket allein genügt nicht; aktuelle Gateway-/Session-Authentifizierung erforderlich. Löschen/Wiederanlage/Schlüsselrotation widerrufen alte Links. |
| Browser-Download | Open-WebUI-Proxy verwendet `get_verified_user`, leitet dessen ID mit serverseitigem Gateway-Token weiter und übernimmt keine Rollen/Identität aus dem Querystring. |
| Pfade | Dateiname ohne Schrägstriche, Backslashes, Steuerzeichen; File-ID genau 64 Hexzeichen. CET konstruiert keine Dateisystempfade aus Eingaben. Filter liest nur den autorisierten OWUI-Storage-Datensatz, nie Anhang-`path`. |
| Typen | Erweiterungs-/MIME-Allowlist; PDF-Magic; UTF-8-/NUL-Prüfung für Text; Office-Container muss zum angegebenen Format passen. |
| Office-Archive | Zentralverzeichnis vor Verarbeitung prüfen; Anzahl/entpackte Gesamtgröße begrenzt. Deflate-Ausgabe je Eintrag begrenzt. Traversal, doppelte Namen, Verschlüsselung, Makros, Embedded Objects, externe Beziehungen und XML-Entitäten/DTD abgewiesen. |
| Größenlimits | HTTP-Bodylimit vor JSON, Base64-Längenlimit vor Decodierung, Bytebudget, Entpackbudget, Tabellenzeilen/-spalten und gemeinsames Dokumentbudget; keine stille Kürzung. |
| Virenscan | Konfigurierbare Broker-Action muss explizit `clean:true` liefern. Fehler/Timeout/negativer Befund verhindern Ablage. Betriebsaktivierung ist im Runbook beschrieben. |
| Audit / Logs | Audit vor erlaubtem Abruf, auch verweigerte Abrufe nach Mappingauflösung; Actor/Tenant/File-ID/Zeit/Outcome, keine Inhalte. Gateway-Request-/Response-Logging bleibt deaktiviert. Proxy-Access-Logs müssen Querystrings auslassen. |
| Lebenszyklus | Abruf und gespeicherte Dokumentgrundlage prüfen Ablauf; Tenant-Purge entfernt abgelaufene Bytes und Evidence. Chat-Löschung entfernt Original und Dokumentevidenz und kompaktier­t PouchDBs; Audit bleibt erhalten. Dataset-Löschung nutzt weiterhin #774. |
| Injection / LLM | Originaltexte bleiben nicht vertrauenswürdige Evidence im bestehenden Review-Pfad. XLSX-Zellwerte werden deterministisch verarbeitet; kein zusätzlicher LLM-/Providerweg. Bestehende Prompt-Injection-Regression bleibt enthalten. |

Synthetische Prüfungen: `tests/file-channel.http.test.js`,
`tests/file-channel-security.test.js`, `tests/file-channel-dataset.test.js`,
`tests/file-channel-filter.test.js`; bestehende Regressionen:
`tests/workbench-document-flow.http.test.js`, `tests/dataset.http.test.js`.
Fixtures entstehen ausschließlich über Generatoren bzw. in-memory-Pakete.

GitNexus: `attachDocuments` HIGH (direkt `documentReply`, indirekt Content-Turn),
`loadDocuments` HIGH (direkt Dokumentantwort/Folgeturn/Export, indirekt Content-Turn).
API-/Workbench-Modul MEDIUM; neue File-Helfer LOW. Die HIGH-Befunde wurden vor den
betroffenen Änderungen gemeldet und sind durch die Betreiberfreigabe abgedeckt.

Betriebsgrenzen: Filter/Proxy pro Open-WebUI-Worker initialisieren; Virenscan aktivieren,
Retention-Action planen und vorhandene Backups nach der betrieblichen Aufbewahrungsregel
behandeln. Der Filter-Contract ist lokal mit synthetischen Open-WebUI-API-Doubles geprüft;
kein Zugriff auf eine produktive Open-WebUI-Installation oder echte Dokumente erforderlich.
