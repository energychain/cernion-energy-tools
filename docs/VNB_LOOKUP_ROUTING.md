# VNB Lookup Routing — Parameter-Mapping-Konvention

> Routing-Regel für reine Netzbetreiber-Identitäts- und Netzgebiet-Anfragen.
> Capability: `grid_operator_identity_resolution`

## Wann greift dieser Pfad?

Reine Anfragen zur Identifikation eines Netzbetreibers (VNB/DSO) anhand von:
- Standort, PLZ, Ort, Adresse
- BDEW-Code, BNR, SNB/GNB (MaStR-ID)
- Firmen-/Unternehmensname
- Netzgebiet-Zuordnung

**Nicht** für: Governance-Entscheidungen (→ VDMI), Netzanschluss-Validierung (→ fNAV), KPI-Benchmarks (→ `vnb_kpi_benchmark_comparison`), Residuallast-Analysen (→ `residual_load_forecast_for_dso`).

## Parameter-Mapping-Konvention

| Eingabe | Ziel-Action | Parameter |
|---------|-------------|-----------|
| PLZ / Postleitzahl | `grid-operations.vnbLookup` | `city` (Ort zum PLZ-Raum) oder `query` (PLZ als Freitext) |
| Ort / Stadt | `grid-operations.vnbLookup` | `city` |
| BDEW-Code | `grid-operations.vnbLookup` | `bdew` |
| SNB / MaStR-ID | `grid-operations.vnbLookupCodes` | `mastrId` |
| BNR | `grid-operations.vnbLookupCodes` | `bnr` |
| Firmenname / Unternehmensname | `grid-operations.marketPartners` zuerst, dann `grid-operations.vnbLookup` mit gefundenem BDEW/Ort | `query` (marketPartners), danach `bdew` / `city` (vnbLookup) |
| Freitext / unstrukturiert | `grid-operations.vnbLookup` | `query` |
| Fehlende Evidenz | `interface-placeholder.markGap` | `role: 'vnb_lookup'`, `reason: 'missing_lookup_evidence'` |

## Execution-Reihenfolge (Firmenname-Pfad)

```
1. grid-operations.marketPartners  { query: "<Firmenname>" }
   → Ergebnis: bdewCode, city, contacts

2. grid-operations.vnbLookup  { bdew: "<bdewCode>", city: "<city>" }
   → Ergebnis: snb, mastrNetzbetreiberId, gridOperatorId

3. (optional) grid-operations.vnbLookupCodes  { bdewCode: "<bdewCode>" }
   → Ergebnis: kanonische Code-Aliases (BDEW, BNR, SNB, GNB)
```

## Execution-Reihenfolge (PLZ/Ort-Pfad)

```
1. grid-operations.vnbLookup  { city: "<Ort>", query: "<PLZ>" }
   → Ergebnis: snb, bdew, Netzbetreiberinformationen

2. (optional) grid-operations.vnbLookupCodes  { bdewCode: "<bdew>" }
   → Ergebnis: kanonische Code-Aliases
```

## Avoid-Liste

Reine Lookup-Anfragen (Identität, Netzgebiet, Zuständigkeit) dürfen **nicht** auf folgende Actions geroutet werden:
- `vdmi.dossier`, `vdmi.agentRole`, `vdmi.negotiationTrace` — nur für Governance-Entscheidungen
- `grid-connection.validate`, `grid-connection.fnavValidate` — nur für Anschlussvalidierung
- `query.ask`, `query.askLearned` — nur als letzter Fallback ohne deterministischen Pfad

## Fehlende-Evidenz-Konvention

Wenn weder Standort, PLZ, BDEW-Code noch Firmenname vorliegen:

```js
interface-placeholder.markGap({
  role: 'vnb_lookup',
  reason: 'missing_lookup_evidence',
  blockingLevel: 'soft',
})
```

Kein Governance-Workflow, keine VDMI-Eskalation.

## Abgrenzung zu verwandten Capabilities

| Anfrage | Richtige Capability |
|---------|---------------------|
| „Welcher VNB ist für PLZ 70173 zuständig?" | `grid_operator_identity_resolution` |
| „Residuallast für Stadtwerke München analysieren" | `residual_load_forecast_for_dso` |
| „Kann der Netzbetreiber ohne §17-Begehren zusagen?" | `vdmi_grid_connection_decision_governance` |
| „fNAV-Prüfung für Rechenzentrum als Alternative zu Kupfer" | `netzfahrplan_fnav_assessment` |
| „Benchmark Netze BW vs. STROMDAO KPI-Vergleich" | `vnb_kpi_benchmark_comparison` |
