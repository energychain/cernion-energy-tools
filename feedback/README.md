# Backend ↔ Frontend Feedback

Dieses Verzeichnis enthält:
1. **Resolutions** auf Feedback aus `cernion-ui/feedback/`
2. **Eigenes Feedback** ans Frontend (selten, aber bei Breaking Changes oder
   Contract-Aktualisierungen)

## Eingehende Feedback-Typen (von cernion-ui)

| Prefix | Typ | Bearbeitung |
|--------|-----|-------------|
| `BR-`  | Bug Report | Fix implementieren, UI-Contract ggf. aktualisieren |
| `CR-`  | Change Request | Bewerten → implementieren oder `wont-fix` begründen |
| `IR-`  | Information Request | Antwort in die Original-Datei schreiben |
| `DR-`  | Documentation Request | UI-Contract aktualisieren |

## Workflow

1. `cernion-ui/feedback/` prüfen (regelmäßig oder bei Benachrichtigung)
2. Status in der Original-Datei auf `acknowledged` setzen
3. Fix implementieren oder Antwort schreiben
4. Optional: `RES-`-Datei hier ablegen mit Details
5. UI-Contract aktualisieren wenn betroffen
6. Status in der Original-Datei auf `resolved` setzen + Backend-Version angeben

## Ausgehende Feedback-Typen (an cernion-ui)

| Prefix | Typ | Wann |
|--------|-----|------|
| `BC-`  | Breaking Change Notice | API-Endpoint ändert Response-Shape oder wird entfernt |
| `CU-`  | Contract Update Notice | UI-Contract wurde aktualisiert — Frontend muss anpassen |
