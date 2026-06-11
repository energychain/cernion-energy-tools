# Cernion Copilot Process Bridge

## Zweck

Der Copilot Process Bridge verbindet MS365 Copilot mit einer **kuratierten Untermenge** der Cernion REST API. Nicht alle 600+ API-Endpunkte werden exponiert — nur explizit freigegebene Operationen aus der Allowlist (`config/copilot-operations.json`).

---

## Vollständige API vs. Copilot-API

| | Vollständige API | Copilot-API |
|--|--|--|
| Export-Datei | `openapi-export.json` | `openapi-copilot.json` |
| Generierung | `npm run export:openapi` | `npm run export:openapi:copilot` |
| Pfad-Anzahl | ~604 | 20 (Phase 2) |
| Zweck | Vollständige Dokumentation, interne Tools | MS365 Copilot Plugin |
| Enthält | Alle Dienste | Nur freigegebene Operationen (read + draft) |
| Auth-Exposure | Vollständig | Nur was Copilot braucht |
| `x-openai-isConsequential` | Teilweise | Immer gesetzt (Phase 2: immer `false`) |
| Pfad-Parameter | Express `:param`-Syntax | OpenAPI `{param}`-Syntax |
| OperationId-Format | Dienstgeneriert (kann Bindestriche enthalten) | Stabile camelCase-IDs ohne Bindestriche |

**Deployment-Hinweis:** Das Plugin-Manifest (`docs/copilot-plugin.json`) zeigt auf `TODO_REPLACE_WITH_DEPLOYMENT_URL/openapi-copilot.json`. Die kuratierte Datei muss unter diesem Pfad öffentlich erreichbar sein — nicht die vollständige API-Spec.

---

## Allowlist-Verwaltung

Die Allowlist wird in `config/copilot-operations.json` gepflegt. Jeder Eintrag hat:

```json
{
  "operationId": "grid-connection_validate",
  "mode": "prepare",
  "requiresConfirmation": true,
  "summary": "Run Netzanschluss validation pipeline",
  "risk": "medium",
  "copilotDescription": "Optional override for Copilot-visible description",
  "notes": "Optional implementation notes"
}
```

**Mode-Typen:**
| mode | x-openai-isConsequential | Seiteneffekte | Agent-Verhalten |
|------|--------------------------|---------------|-----------------|
| `read` | `false` | keine | Direkt aufrufbar |
| `draft` | `false` | keine | Direkt aufrufbar, gibt Entwurf zurück |
| `prepare` | `true` | schreibt Daten | Explizite Nutzerbestätigung erforderlich |
| `consequential` | `true` | irreversible Änderung | Nicht in Phase 2 exponiert |

---

## Freigegebene Operationen

### Read-only (mode: read, risk: low)

| operationId | Endpunkt | Beschreibung |
|-------------|----------|--------------|
| `searchCernionData` | `GET /api/query/search` | Entitätssuche über alle Domains |
| `getVdmiContext` | `GET /api/copilot-process/vdmi/:matrixId/context` | VDMI-Matrix-Kontext laden |
| `listOpenResponsibilities` | `GET /api/copilot-process/vdmi/responsibilities` | Offene VDMI-Verantwortlichkeiten |
| `getZnpProjectStatus` | `GET /api/copilot-process/znp/:projectId/status` | ZNP-Projektstatus |
| `getGridConnectionValidation` | `GET /api/copilot-process/grid-connection/:validationId` | Validierungsbericht |
| `vdmi_context` | `GET /api/vdmi/context` | Aktiver VDMI-Matrixkontext (Job-basiert) |
| `vdmi_myResponsibilities` | `GET /api/vdmi/my-responsibilities` | Eigene V-Verantwortlichkeiten |
| `vdmi_findings` | `GET /api/vdmi/findings` | VDMI Governance-Findings |
| `vdmiFindingsList` | `GET /api/vdmi/tenants/{tenantId}/findings` | Findings (Multi-Tenant-Pfad) |
| `vdmi_dossier` | `GET /api/vdmi/tasks/:taskId/dossier` | Entscheidungsdossier (V-Rolle) |
| `znp_listProjects` | `GET /api/znp/projects` | ZNP-Projektliste |
| `znp_getProjectMeta` | `GET /api/znp/projects/:projectId` | ZNP-Projektmetadaten |
| `znp_getProjectAssets` | `GET /api/znp/projects/:projectId/assets` | Layer-0-Assets eines ZNP-Projekts |
| `gridConnectionList` | `GET /api/grid-connection/validations` | Netzanschluss-Validierungsliste |
| `gridConnectionGet` | `GET /api/grid-connection/validations/{id}` | Einzelner Validierungsbericht |
| `connectionRejectionEvidenceList` | `GET /api/connection-rejection-evidence/packages` | Ablehnungsnachweise |
| `connectionRejectionEvidenceGet` | `GET /api/connection-rejection-evidence/packages/{id}` | Einzelner Ablehnungsnachweis |

### Draft/Propose (mode: draft, risk: low, keine Seiteneffekte)

| operationId | Endpunkt | Beschreibung |
|-------------|----------|--------------|
| `prepareVdmiValidation` | `POST /api/copilot-process/vdmi/:matrixId/prepare-validation` | Nominierungsentwurf (kein Schreiben) |
| `draftVdmiEvidence` | `POST /api/copilot-process/vdmi/:matrixId/draft-evidence` | Evidenz-Vorschläge (kein Schreiben) |
| `prepareGridConnectionValidation` | `POST /api/copilot-process/grid-connection/prepare-validation` | Validierungs-Config-Entwurf |

### Prepare/Consequential (Phase 3 — nicht im Phase-2-Subset)

Die folgenden schreibenden Operationen existieren in der vollständigen API, sind aber im Phase-2-Copilot-Subset **nicht** exponiert (`x-openai-isConsequential: true`, in der Blocklist). Sie werden in Phase 3 als kontrollierte Execute-Aktionen eingeführt.

| operationId (API) | Endpunkt | Beschreibung |
|-------------|----------|--------------|
| `vdmi_evidence` | `POST /api/vdmi/{id}/evidence` | Evidenz in VDMI-Matrix einpflegen |
| `connection-rejection-evidence_create` | `POST /api/connection-rejection-evidence/packages` | Ablehnungsnachweis erstellen |
| `grid-connection_validate` | `POST /api/grid-connection/validate` | 6-stufige Netzanschluss-Validierung (~2 min) |
| `grid-connection_validateMesskonzeptConflict` | `POST /api/grid-connection/messkonzept/conflict/validate` | Messkonzept-Konfliktprüfung |
| `grid-connection_fnavValidate` | `POST /api/grid-connection/fnav/validate` | FNAV-Validierung |
| `znp_addAssumption` | `POST /api/znp/projects/{projectId}/assumptions` | Planungsannahme hinzufügen |

---

## Bewusst gesperrte Operationen

Die folgenden Operationen sind explizit in der Blocklist (`blocklist` in `config/copilot-operations.json`) und dürfen nicht freigegeben werden:

| operationId | Grund |
|-------------|-------|
| `znp_deleteProject` | Irreversibel — löscht Projekt und alle Graph-Daten |
| `vdmi_revert` | Revert zu früherem Zustand — erfordert menschliche Aufsicht |
| `vdmi-human-override_override` | Manuelles HITL-Override — erfordert menschliche Autorität |
| `vdmi-human-override_revert` | Revert eines HITL-Overrides |
| `vdmi-evidence_sign` | Kryptografische Signatur — irreversibel, rechtliche Wirkung |
| `vdmi_confirmNomination` | Finale Nominierungs-Genehmigung — irreversibler Workflow-Schritt |
| `vdmi_nominate` | Nominierungs-Trigger — erfordert menschliche Autorität |
| `vdmi_create`, `vdmi_update`, `vdmi_detect` | Schreibende VDMI-Operationen — nicht für Copilot-Workflows |
| `znp_createProject`, `znp_addLayer0`, `znp_addLayer1`, `znp_addLayer2` | Bulk-Importe — nicht Copilot-sicher |
| `vdmi-portfolio-gatekeeping_gate` | Portfolio-Gate-Entscheidung — erfordert menschliche Autorität |

---

## Deployment

### Schritte

1. **Subset generieren**: `npm run export:openapi:copilot` → erzeugt `openapi-copilot.json`
2. **Datei servieren**: `openapi-copilot.json` muss unter `<DEPLOYMENT_URL>/openapi-copilot.json` erreichbar sein
3. **Plugin-Manifest anpassen**:
   - `TODO_REPLACE_WITH_DEPLOYMENT_URL` → z.B. `https://cernion.example.com`
   - `TODO_REPLACE_WITH_VAULT_REFERENCE_ID` → Azure Key Vault Reference ID für den API-Key
4. **Copilot Studio**: Manifest (`docs/copilot-plugin.json` + `docs/copilot-agent.json`) hochladen, TODOs ersetzen

### Umgebungsvariablen

```env
COPILOT_DEPLOYMENT_URL=https://your-cernion-deployment.example.com
COPILOT_VAULT_REFERENCE_ID=<azure-key-vault-reference-id>
```

### Verifizierung nach Deployment

```bash
# Prüfe, dass alle 20 erlaubten OperationIds im Subset sind (Phase 2)
node -e "
const spec = require('./openapi-copilot.json');
const ids = Object.values(spec.paths).flatMap(p => Object.values(p).map(op => op.operationId));
console.log('Operations:', ids.length, '| Paths:', Object.keys(spec.paths).length);
const blocked = ['znp_deleteProject','vdmi_evidence','grid-connection_validate','znp_addAssumption'];
blocked.forEach(id => console.log(id, ids.includes(id) ? 'PRESENT (ERROR)' : 'absent (ok)'));
"
```

---

## Wartung der Allowlist

Wenn neue Operationen freigegeben werden sollen:
1. Eintrag in `allowlist` in `config/copilot-operations.json` hinzufügen
2. Eintrag mit korrektem `mode`, `requiresConfirmation`, `summary`, `risk` befüllen
3. `npm run export:openapi:copilot` ausführen
4. `docs/copilot-plugin.json` → neuen Eintrag in `functions[]` und `run_for_functions[]` ergänzen
5. Tests laufen lassen: `npm test -- --testPathPatterns=copilot-openapi-subset`
6. `openapi-copilot.json` committen

Wenn Operationen gesperrt werden sollen: aus `allowlist` entfernen, in `blocklist` eintragen.
