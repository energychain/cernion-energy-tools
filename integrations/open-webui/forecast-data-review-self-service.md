# Open WebUI Self-Service: Forecast & Data-Quality Fit Review (#669)

This RC3 product path is a buyer-readable Open WebUI workflow for non-technical energy-market users. It shows the product shape before API, repository or integration details: sample file in, Cernion review/forecast-fit result out, then a bounded commercial next step.

## Positioning

Preferred user framing:

`Excel / CSV input -> Cernion review / forecast-fit / data-quality result -> downloadable report / fit matrix -> optional paid review, pilot or API/model access`

The REST API remains the implementation layer. It is not the first product image for a business buyer.

## Open WebUI starter prompt

Use this as the standard assistant starter or prompt-button text:

```text
Starte den Cernion Forecast & Data-Quality Fit Check als Self-Service Preview.

Zielgruppe: nicht-technischer Energieversorger-Fachnutzer.

Bitte erkläre zuerst kurz:
1. welches Geschäftsproblem geprüft wird,
2. welche Excel/CSV-Eingaben geeignet sind,
3. welches Ergebnis sichtbar wird,
4. welche Grenzen gelten,
5. welcher bezahlte nächste Schritt möglich ist.

Nutze die synthetischen Beispielartefakte:
- integrations/open-webui/examples/forecast-fit/sample-load-profile.csv
- integrations/open-webui/examples/forecast-fit/sample-fit-matrix.json
- integrations/open-webui/examples/forecast-fit/sample-report.md

Wichtig:
- keine Prognosegüte garantieren,
- keinen produktiven Betrieb, SLA oder Systemintegration versprechen,
- keine Rechts-/Regulierungsberatung behaupten,
- API-Details erst als Advanced Path nennen,
- bei echter Kundendatei erst Evidenz, Hash, Zeitraum, Spaltenmapping und Caveats sichtbar machen.
```

## First-screen copy

Title: `Forecast & Data-Quality Fit Check`

Short copy:

> Prüfen Sie mit einer Beispiel- oder eigenen CSV/XLSX-Datei, ob Ihre Lastgang-/Messdaten für eine Cernion Forecast- oder Datenqualitätsprüfung geeignet sind. Sie erhalten eine Fit-Matrix, Qualitätsflags, Metrik-Caveats und eine Empfehlung für den nächsten Schritt. Dies ist eine Preview, kein Produktivbetrieb und keine Prognosegüte-Garantie.

## User flow

1. Choose use case:
   - load-profile forecast fit
   - data-quality review
   - forecast pilot readiness
2. Show sample input structure.
3. Show synthetic sample report and fit matrix.
4. Optional: let the user describe/upload a file in Open WebUI.
5. Ask for column mapping if needed.
6. Produce a preview report with caveats.
7. Recommend one of: `park`, `paid_review`, `pilot`, `api_model_access`.

## Suitable input types

- CSV/XLSX load profiles
- MaLo / meter time series exports
- timestamp + consumption/production value columns
- optional meter/location/context metadata
- optional holiday/weather/context hints

## Expected output

- fit matrix
- data-quality flags
- metric definitions and caveats
- missing-context warnings
- recommended next step
- downloadable/report-style markdown or PDF later

## Guardrails

The assistant must not imply:

- guaranteed forecast quality
- productive approval
- SLA
- finished customer-specific UI/system integration
- legal/regulatory advice
- free implementation or architecture consulting

When the user asks for integration design, redirect to a paid discovery/pilot path.

## Evidence metadata to show

For any generated preview/report, show:

- input file name or sample artifact id
- input hash/fingerprint where available
- evaluation period
- metric definitions
- configuration/version label
- caveats and missing-context warnings
- generated-at timestamp

## Advanced path

After the business preview is understood, the assistant may point to the API/model path as an advanced integration option. It should not lead with endpoint mechanics.
