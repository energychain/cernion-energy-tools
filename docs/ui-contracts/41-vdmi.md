# UI Contract 41 — VDMI API (v0.53.0)

## Scope
VDMI matrix lifecycle, nomination governance, findings workflows, A2A spectator transparency, and **system-wide anonymized governance templates** (v0.53.0+).

## Base
- Service: `vdmi`
- Base path: `/api/vdmi`
- Tenant scope: required via gateway tenant context (`tenantId`)
- System templates: available tenant-overarching via `GET /api/vdmi/templates` (all tenants see identical system templates)

## Endpoints

### Matrix lifecycle
- `GET /api/vdmi`
- `GET /api/vdmi/:id`
- `POST /api/vdmi`
- `POST /api/vdmi/detect`

### Nomination
- `GET /api/vdmi/nominations`
- `POST /api/vdmi/:id/nominate`
- `POST /api/vdmi/:id/confirm-nomination`
- `GET /api/vdmi/templates` (returns tenant-local + system templates)

### Human governance
- `PATCH /api/vdmi/:id`
- `POST /api/vdmi/:id/revert`
- `POST /api/vdmi/:id/evidence`

### Spectator mode
- `GET /api/vdmi/tasks/:taskId/negotiation-trace`
- `GET /api/vdmi/tasks/:taskId/dossier`

### Findings workflow
- `GET /api/vdmi/findings`
- `POST /api/vdmi/findings/:findingId/mitigate`
- `POST /api/vdmi/findings/:findingId/resolve`

### Role/context lookups
- `GET /api/vdmi/my-responsibilities`
- `GET /api/vdmi/my-informed`
- `GET /api/vdmi/agent/:agentId/role`
- `GET /api/vdmi/context`

## Core response fragments

### Matrix
```json
{
  "id": "<uuid>",
  "processId": "job-123",
  "processType": "adhoc",
  "name": "Netzanschluss-Genehmigung PV",
  "tasks": [],
  "nominationStatus": "pending",
  "detectionConfidence": 0.92,
  "patternMatchCount": 6,
  "promotionThreshold": 10,
  "version": 2
}
```

### Finding
```json
{
  "id": "<uuid>",
  "matrixId": "<uuid>",
  "code": "VD_SHADOW_SHAREPOINT_BYPASS_H",
  "severity": "H",
  "status": "open",
  "message": "Shadow-process signal detected",
  "occurrenceCount": 1
}
```

### System Template (v0.53.0+)
```json
{
  "id": "SYSTEM_grid-connection-approval-pv",
  "name": "Grid Connection Approval (PV Plant)",
  "scope": "§8 NAV Netzanschlussprozess, anonymisiert",
  "processType": "grid-connection-governance",
  "assetCategory": "solar",
  "description": "Standardisierte Governance für Netzanschlussbegehren PV-Anlage. Role-basiert, keine Kundendaten.",
  "regulatoryBasis": ["§8 NAV", "§11 EnWG"],
  "taskTemplates": [
    {
      "taskId": "formal-review",
      "taskName": "Formale Antragsprüfung",
      "phase": "intake",
      "verantwortlich": [{"actorType": "role", "actorId": "DSO_GATEKEEPER"}],
      "durchfuehrend": [{"actorType": "role", "actorId": "APPLICATION_ADMIN"}],
      "mitwirkend": [{"actorType": "role", "actorId": "COMPLIANCE_ANALYST"}],
      "information": [{"actorType": "role", "actorId": "APPLICANT_NOTARY"}]
    }
  ],
  "isSystemDefault": true,
  "createdAt": "2026-05-19T00:00:00.000Z"
}
```

## System Templates (v0.53.0+)

5 anonymized system templates are automatically seeded on service startup. All templates:
- Use stable IDs with prefix `SYSTEM_` (e.g., `SYSTEM_grid-connection-approval-pv`)
- Are fully anonymized (no customer data, generic asset names like "PV_Asset_North", role-based actors)
- Are queryable from all tenants (originTenant: `*`)
- Support versioned upsert (Option B): update on templateVersion bump, no-op if same version
- Include role-based governance tasks (Verantwortlich/Durchfuehrend/Mitwirkend/Information)

### List of System Templates

#### 1. Grid Connection Approval (PV Plant)
- **ID**: `SYSTEM_grid-connection-approval-pv`
- **Scope**: §8 NAV Netzanschlussprozess
- **Process Type**: `grid-connection-governance`
- **Regulatory**: §8 NAV, §11 EnWG
- **Tasks**:
  - `formal-review`: Formale Antragsprüfung (V=DSO, D=Asset Owner, M=Compliance, I=Applicant)
  - `network-operator-decision`: Verbindliche Anschlusszusage (V=DSO Decision-Maker, D=Asset Owner, M=Planning Authority, I=Neighbors)
- **Use Case**: Standard PV grid connection requests with formal evidence collection and DSO decision point

#### 2. Energy Sharing Collective Approval
- **ID**: `SYSTEM_energy-sharing-collective-approval`
- **Scope**: Nachbarschaftliche Strombilanzgruppe (§21 Abs. 2 EnWG)
- **Process Type**: `energy-sharing-governance`
- **Regulatory**: §21 Abs. 2 EnWG, MESRL, §42 EnWG
- **Tasks**:
  - `collective-design-review`: ESG-Design-Review (V=ESG Operator, D=Metering Provider, M=Balancing Authority, I=End Consumers)
  - `collective-settlement-approval`: Bilanzielle Freigabe (V=Balancing Authority, D=ESG Operator, M=Clearing House, I=TSO)
- **Use Case**: Neighborhood energy sharing arrangements with metering and settlement validation

#### 3. Portfolio Gating Decision (Redispatch)
- **ID**: `SYSTEM_portfolio-gating-redispatch`
- **Scope**: Direktvermarktungs-Portfolio Freigabe
- **Process Type**: `portfolio-governance`
- **Regulatory**: §4 Abs. 5 AusglMechV, Redispatch 2.0 UmsV
- **Tasks**:
  - `portfolio-capacity-check`: Kapazitätscheck Portfolio (V=Portfolio Manager, D=DMS System, M=TSO Advisory, I=Grid Operator)
  - `portfolio-settlement-validation`: Abrechnungsvalidierung (V=Portfolio Manager, D=DMS System, M=Market Analyst, I=BNetzA)
- **Use Case**: Enrollment/withdrawal from Redispatch 2.0 with capacity and settlement validation

#### 4. Substation Load Assessment
- **ID**: `SYSTEM_substation-load-assessment`
- **Scope**: Kapazitätsengpass-Bewertung
- **Process Type**: `grid-capacity-governance`
- **Regulatory**: TAR Netz, Verteilnetzkodex, EnWG §14a
- **Tasks**:
  - `load-data-collection`: Lastdaten-Sammlung (V=Network Engineer, D=Expansion Planning, M=Regional Authority, I=Distribution Customers)
  - `expansion-decision`: Ausbauentscheidung (V=Network Engineer Lead, D=Procurement, M=Finance, I=Regulatory Affairs)
- **Use Case**: Transformer bottleneck assessment with load data collection and expansion decision

#### 5. Redispatch Participation Confirmation
- **ID**: `SYSTEM_redispatch-participation-confirmation`
- **Scope**: Redispatch 2.0 Teilnahmebestätigung
- **Process Type**: `redispatch-enrollment`
- **Regulatory**: §4 Abs. 3a AusglMechV, Redispatch 2.0 UmsV, EnLAG
- **Tasks**:
  - `enrollment-eligibility-check`: Teilnahmefähigkeit prüfen (V=Redispatch Operator, D=Installation Owner, M=Market Analyst, I=BNetzA)
  - `redispatch-operational-readiness`: Operationale Readiness (V=Redispatch Operator Lead, D=Installation Owner, M=System Operator, I=TSO Grid Monitoring)
- **Use Case**: Redispatch 2.0 enrollment with remote control capability verification and operational readiness tests

## UI behaviors
- Require mandatory reason text for `PATCH` and `revert` flows.
- Use `negotiation-trace` for timeline replay and `dossier` for management summary card.
- Expose findings by severity/status tabs (`L/M/H/K`, `open/mitigated/resolved`).
- Show tenant-local data only; system templates are shared read-only across all tenants.
- System templates can be used as governance reference templates for new nominations.
- Template `id` field allows filtering: `id.startsWith('SYSTEM_')` → system template, otherwise tenant-created template.

## Data Minimization & Compliance
- All system templates contain **no real customer data** (DSGVO Art. 32 & recital 26)
- Asset identifiers are generic (e.g., "PV_Asset_North", "Substation_A", "Portfolio_Mix_East")
- Actors identified by **role+category**, not individual/organization names
- Evidence requirements are process-generic, not customer-specific
- Finanzamt-compliant anonymization for regulatory reporting use cases

