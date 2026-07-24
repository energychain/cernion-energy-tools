# CET Release Signal Extractor

Interner, read-only Prototyp zur Extraktion neutraler Rohsignale aus `CHANGELOG.md` und der lokalen OpenAPI-Datei `openapi-export.json`.

## Zweck

Das Skript `scripts/extract-release-signals.js` liest nur lokale Dateien und gibt einen JSON- oder Markdown-Report auf `stdout` aus. Es erkennt:

- neue/geänderte Endpoints, soweit sie im Changelog erwähnt und im OpenAPI-Dokument vorhanden sind,
- OpenAPI-Operationen mit Methode, Pfad, `operationId`, Service/Tag, Summary und Description,
- Service-/Tag-Cluster aus OpenAPI,
- changelog-nahe Release-Hinweise inklusive Section, Release, Issue-Refs und Endpoint-Refs.

## Klare Grenze

Der Report ist ein Rohsignal. Das Skript erstellt keine GitHub-Issues oder PRs, ändert keine Website, schreibt keine Kanban-Karten, deployed nichts und veröffentlicht nichts extern.

## Aufruf

```bash
node scripts/extract-release-signals.js --format=json --limit=10
node scripts/extract-release-signals.js --format=markdown --limit=10
node scripts/extract-release-signals.js --changelog=CHANGELOG.md --openapi=openapi-export.json
npm run extract:release-signals -- --format=markdown --limit=10
```

## Beispielinput

Minimaler Changelog-Ausschnitt:

```md
## Unreleased

### Added

- **Municipal Energy Value Lagebild Endpoint** (#324): New endpoint `GET /api/dashboard/municipal-energy-value-analysis` exposes read-only rows.
```

Minimale OpenAPI-Operation:

```json
{
  "openapi": "3.0.0",
  "info": { "title": "Cernion Energy Tools API", "version": "0.67.x" },
  "paths": {
    "/api/dashboard/municipal-energy-value-analysis": {
      "get": {
        "operationId": "dashboard_municipalEnergyValueAnalysisStatus",
        "summary": "Municipal Energy Value Lagebild Endpoint",
        "description": "Read-only municipal energy value analysis.",
        "tags": ["Dashboard API"]
      }
    }
  }
}
```

## Beispieloutput (gekürzt)

```json
{
  "schemaVersion": "cernion.releaseSignals.v1",
  "extractionOnly": true,
  "publicationBoundary": "No GitHub issues, PRs, website changes, deployments, or external publication are performed.",
  "openapi": {
    "title": "Cernion Energy Tools API",
    "version": "0.67.x",
    "pathCount": 1,
    "operationCount": 1,
    "tagCount": 1
  },
  "signals": {
    "endpointSignals": [
      {
        "kind": "openapi-operation",
        "changeClass": "changelog-added",
        "method": "GET",
        "path": "/api/dashboard/municipal-energy-value-analysis",
        "operationId": "dashboard_municipalEnergyValueAnalysisStatus",
        "service": "Dashboard API",
        "tags": ["Dashboard API"],
        "summary": "Municipal Energy Value Lagebild Endpoint",
        "changelogLinks": [{ "release": "Unreleased", "section": "Added", "score": 100 }],
        "publicationBoundary": "raw-extraction-only"
      }
    ]
  }
}
```

## Fehlerbehandlung

- Fehlende Dateien enden mit `MISSING_FILE` und Exit-Code 1.
- Ungültiges OpenAPI-JSON endet mit `INVALID_JSON` und Exit-Code 1.
- OpenAPI-Dokumente ohne `paths` enden mit `INVALID_OPENAPI` und Exit-Code 1.
- Nicht unterstützte Ausgabeformate enden mit `INVALID_FORMAT` und Exit-Code 1.
