# VDMI Governance APIs — Mensch-Maschine-Interaktion & Workflow (v0.50.2)

## Übersicht

Dieses Dokument spezifiziert die **vier kritischen HITL-Domänen** (Human-in-the-Loop) für VDMI-Matrix-Governance. Die bisherigen APIs (Kap. 6.1–6.4) fokussieren auf automatisierte Maschinen-Inferenz. Dieses Kapitel erweitert das Framework um menschliche Governance-Workflows für das Vue.js-Dashboard:

1. **Human Override & Audit Trail** – Korrektur von LLM-Inferenzen
2. **Spectator Mode für A2A-Dialoge** – Transparenz in Agenten-Verhandlungen
3. **Governance-Findings-Workflow** – Shadow-IT-Abweichungen als Tickets
4. **Offline-Realität & Evidenz-Injektion** – Manuelle Nachweise für blockierte Prozesse

Alle Endpunkte sind **tenant-bound** und nutzen etablierte Rollen (`hitl-approver`, `data-steward`, `matrix-admin`).

---

## 6.5.1 Human Override: Korrektur & Editierung von Matrizen

### PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId

**Korrektur von LLM-Inferenzen mit obligatorischer Begründung**

```http
PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId
Content-Type: application/json
Authorization: Bearer {token}
X-Request-ID: {uuid}
```

**Request Body:**
```json
{
  "overrides": {
    "roles": [
      {
        "roleId": "ROLE_APP_OWNER_DEV",
        "assignments": {
          "accountable": "john.doe@company.com",
          "informed": ["alice@company.com", "bob@company.com"]
        },
        "precedenceScore": 8.5
      }
    ]
  },
  "rationale": "Corrected based on organizational restructuring Q2-2024",
  "changeCategory": "organizational_change",
  "urgency": "high",
  "timestamp": "2024-02-15T14:32:00Z"
}
```

**Response (200 OK):**
```json
{
  "id": "matrix-12345",
  "tenantId": "tenant-xyz",
  "status": "pending_review",
  "version": 3,
  "changes": {
    "modified_roles": 1,
    "audit_trail_entries": 1
  },
  "auditEntry": {
    "id": "audit-67890",
    "action": "MATRIX_OVERRIDE",
    "actorId": "john.doe@company.com",
    "actorRole": "hitl-approver",
    "rationale": "Corrected based on organizational restructuring Q2-2024",
    "changeCategory": "organizational_change",
    "previousVersion": 2,
    "currentVersion": 3,
    "timestamp": "2024-02-15T14:32:00Z"
  }
}
```

**Validierungen:**
- Rolle des Requesters: `hitl-approver`, `data-steward`, `matrix-admin`
- Rationale: mind. 20 Zeichen
- Matrix-Status: nur `approved` oder `pending_review` darf editiert werden
- Maximale 5 offene Overrides pro Matrix

**Error Cases:**
- `403 Forbidden` – Insufficient permissions
- `409 Conflict` – Concurrent modification
- `422 Unprocessable Entity` – Validation error

---

### POST /api/vdmi/tenants/:tenantId/matrices/:matrixId/revert

**Version-Rollback mit Audit-Trail**

```http
POST /api/vdmi/tenants/:tenantId/matrices/:matrixId/revert
Content-Type: application/json
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "targetVersion": 1,
  "reason": "Previous version was more aligned with actual responsibilities",
  "notifyStakeholders": true
}
```

**Response (200 OK):**
```json
{
  "id": "matrix-12345",
  "previousVersion": 3,
  "targetVersion": 1,
  "currentVersion": 4,
  "revertedAt": "2024-02-15T14:35:00Z",
  "revertedBy": "john.doe@company.com",
  "auditEntry": {
    "id": "audit-67891",
    "action": "MATRIX_REVERT",
    "fromVersion": 3,
    "toVersion": 1,
    "timestamp": "2024-02-15T14:35:00Z"
  },
  "notificationsQueued": ["alice@company.com", "bob@company.com"]
}
```

---

## 6.5.2 Spectator Mode: A2A-Dialog-Transparenz

### GET /api/vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace

**Agenten-Verhandlungen mit vollständiger Transparenz**

```http
GET /api/vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace
Authorization: Bearer {token}

Query Parameters:
  ?phase=all                    # all, proposal, consensus, conflict_resolution
  ?agentFilter=A1,A2            # Filter by specific agents
```

**Response (200 OK):**
```json
{
  "taskId": "task-abc123",
  "tenantId": "tenant-xyz",
  "negotiationPhase": "consensus_reached",
  "totalRounds": 5,
  "consensusReachedAt": "2024-02-15T14:20:00Z",
  "trace": [
    {
      "round": 1,
      "timestamp": "2024-02-15T14:15:00Z",
      "agent": "A1",
      "role": "System_Analyzer",
      "action": "PROPOSE_MATRIX",
      "argument": {
        "roleId": "ROLE_APP_OWNER_DEV",
        "reasoning": "Based on system registry: app-123 registered with dept-456",
        "confidence": 0.92,
        "evidence": {
          "sources": ["cmdb-entry-789", "ad-group-membership"],
          "timestamp": "2024-02-15T13:00:00Z"
        }
      },
      "proposedAssignment": {
        "accountable": "anna.schmidt@company.com",
        "responsible": "dev-team@company.com",
        "consulted": ["ops-team@company.com"],
        "informed": ["executive-sponsor@company.com"]
      },
      "precedenceScore": 0.85
    }
  ],
  "consensusMatrix": {
    "id": "matrix-12345",
    "version": 1,
    "roles": [
      {
        "roleId": "ROLE_APP_OWNER_DEV",
        "accountable": "anna.schmidt@company.com",
        "precedenceScore": 0.72
      }
    ]
  }
}
```

**Zugriffskontrolle:**
- `spectator`, `hitl-approver`, `data-steward`, `matrix-admin`

---

### GET /api/vdmi/tenants/:tenantId/tasks/:taskId/dossier

**Governance-Entscheidungs-Dokument für Rolle V**

```http
GET /api/vdmi/tenants/:tenantId/tasks/:taskId/dossier
Authorization: Bearer {token}

Query Parameters:
  ?format=json                  # json, html, pdf
  ?includeDelta=true            # Diff gegen vorherige Version
```

**Response (200 OK):**
```json
{
  "dossier": {
    "id": "dossier-abc123",
    "taskId": "task-abc123",
    "createdAt": "2024-02-15T14:20:00Z",
    "summary": {
      "title": "VDMI Matrix Update: ERP System Landscape",
      "affectedApplications": 12,
      "affectedRoles": 23,
      "riskLevel": "medium"
    },
    "executive_summary": "12 applications reassigned. 4 critical roles updated. No access violations detected.",
    "governance_checks": {
      "access_control": {
        "status": "passed",
        "findings": []
      },
      "separation_of_duties": {
        "status": "passed"
      },
      "least_privilege": {
        "status": "warning",
        "message": "One role now has 3 applications; median is 1.5"
      }
    },
    "humanTouchpoints": [
      {
        "type": "low_confidence_warning",
        "affectedMatrices": 2,
        "threshold": 0.75,
        "action": "Manual review recommended"
      }
    ]
  }
}
```

---

## 6.5.3 Governance-Findings-Workflow

### GET /api/vdmi/tenants/:tenantId/findings

**Tenant-scoped Liste offener Abweichungen**

```http
GET /api/vdmi/tenants/:tenantId/findings
Authorization: Bearer {token}

Query Parameters:
  ?status=pending_approval,proposed
  ?severity=critical,high
  ?category=missing_evidence,access_anomaly
  ?limit=50&offset=0
```

**Response (200 OK):**
```json
{
  "tenantId": "tenant-xyz",
  "totalFindings": 23,
  "findings": [
    {
      "id": "finding-001",
      "taskId": "task-abc123",
      "matrixId": "matrix-12345",
      "status": "proposed",
      "severity": "critical",
      "category": "missing_dual_evidence",
      "discoveredAt": "2024-02-15T14:20:00Z",
      "title": "Missing Dual Evidence: ROLE_APP_OWNER",
      "description": "Role assignment cannot be verified with dual-source evidence.",
      "affectedApplication": "app-erp-main",
      "affectedRole": "ROLE_APP_OWNER_DEV",
      "affectedUser": "new.owner@company.com",
      "lifecycle": {
        "status": "proposed",
        "triageStatus": null,
        "triageAssignee": null,
        "approvalStatus": null,
        "appliedAt": null
      },
      "dueDate": "2024-02-22T23:59:59Z"
    }
  ],
  "summary": {
    "byStatus": {
      "proposed": 10,
      "triaged": 8,
      "pending_approval": 3
    },
    "bySeverity": {
      "critical": 2,
      "high": 8,
      "medium": 10,
      "low": 3
    }
  }
}
```

---

### POST /api/vdmi/tenants/:tenantId/findings/:findingId/mitigate

**Maßnahmenplan einreichen**

```http
POST /api/vdmi/tenants/:tenantId/findings/:findingId/mitigate
Content-Type: application/json
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "mitigationStrategy": "manual_evidence_injection",
  "proposedActions": [
    {
      "actionType": "request_hr_confirmation",
      "description": "Contact HR to confirm role in Cloud Platform Dept",
      "owner": "department-head@company.com",
      "targetDate": "2024-02-17T23:59:59Z"
    }
  ],
  "riskAssessment": {
    "riskIfApproached": "low",
    "riskIfIgnored": "high",
    "businessImpact": "Blocks ERP system handover"
  },
  "approvalRequired": true
}
```

**Response (201 Created):**
```json
{
  "id": "finding-001",
  "status": "pending_approval",
  "mitigation": {
    "id": "mitigation-xyz",
    "strategy": "manual_evidence_injection",
    "createdBy": "john.doe@company.com",
    "createdAt": "2024-02-15T14:32:00Z",
    "approvalChain": [
      {
        "approver": "compliance-officer@company.com",
        "role": "hitl-approver",
        "status": "pending",
        "dueDate": "2024-02-16T23:59:59Z"
      }
    ]
  }
}
```

---

### POST /api/vdmi/tenants/:tenantId/findings/:findingId/resolve

**Finding schließen (HITL-basiert)**

```http
POST /api/vdmi/tenants/:tenantId/findings/:findingId/resolve
Content-Type: application/json
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "resolutionType": "mitigated_with_evidence",
  "justification": "HR confirmed employment and department assignment.",
  "evidenceProof": {
    "sourceId": "hr-evt-446",
    "sourceType": "hr_system_event",
    "confirmedAt": "2024-02-16T10:30:00Z",
    "confirmedBy": "hr-admin@company.com"
  },
  "statusAfterResolution": "approved",
  "applyChanges": true
}
```

**Response (200 OK):**
```json
{
  "id": "finding-001",
  "status": "applied",
  "lifecycle": {
    "proposed": "2024-02-15T14:20:00Z",
    "triaged": "2024-02-15T15:00:00Z",
    "pending_approval": "2024-02-15T15:15:00Z",
    "approved": "2024-02-16T09:00:00Z",
    "applied": "2024-02-16T14:35:00Z"
  },
  "resolutionSummary": {
    "type": "mitigated_with_evidence",
    "appliedChanges": {
      "matrixId": "matrix-12345",
      "roleId": "ROLE_APP_OWNER_DEV",
      "precedenceScore": 0.92,
      "dualEvidenceNowSatisfied": true
    }
  }
}
```

---

## 6.5.4 Offline-Realität: Evidenz-Injektion

### POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence

**Manuelle Evidenz nachreichen für blockierte Prozesse**

```http
POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence
Content-Type: application/json
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "evidenceType": "manual_confirmation",
  "category": "hr_confirmation",
  "data": {
    "confirmingPerson": "hr-manager@company.com",
    "confirmedUser": "new.owner@company.com",
    "confirmedRole": "Cloud Platform Engineer",
    "confirmedDepartment": "Cloud Platform Division",
    "effectiveDate": "2024-02-08",
    "confirmationMethod": "email_signed",
    "confirmationReference": "HR-TRANSFER-2024-0246"
  },
  "affectedMatrix": {
    "roleId": "ROLE_APP_OWNER_DEV",
    "applicationId": "app-erp-main"
  },
  "sourceQuality": "high",
  "signatureRequired": true,
  "rationale": "HR system feed delayed; manual confirmation obtained from HR manager",
  "timestamp": "2024-02-16T11:00:00Z"
}
```

**Response (201 Created):**
```json
{
  "evidence": {
    "id": "evidence-manual-001",
    "taskId": "task-abc123",
    "type": "manual_confirmation",
    "category": "hr_confirmation",
    "status": "pending_signature",
    "createdAt": "2024-02-16T11:00:00Z",
    "createdBy": "john.doe@company.com",
    "dualEvidenceStatus": {
      "firstSource": {
        "type": "cmdb_system_registry",
        "status": "present",
        "timestamp": "2024-02-15T10:00:00Z"
      },
      "secondSource": {
        "type": "hr_confirmation",
        "status": "pending_injection",
        "evidence_id": "evidence-manual-001"
      },
      "dualEvidenceSatisfied": false,
      "satisfiedAfterSignature": true
    }
  },
  "signatureRequest": {
    "id": "sig-req-001",
    "requiredBy": "john.doe@company.com",
    "requestedFrom": ["hr-manager@company.com", "compliance-officer@company.com"],
    "expiresAt": "2024-02-17T11:00:00Z",
    "signingPortalLink": "/auth/sign/sig-req-001"
  },
  "matrixImpact": {
    "matrixId": "matrix-12345",
    "willUnblockMatrix": true,
    "triggeredApprovalAfterSignature": true
  }
}
```

---

## Sicherheit & Compliance

| Aspekt | Implementierung |
|--------|-----------------|
| **Audit Logging** | Alle Operationen → immutable Audit-Trail mit Actor, Timestamp, Delta |
| **Role-Based Access** | `hitl-approver`, `data-steward`, `matrix-admin`, `spectator` (read-only) |
| **Dual Approval** | Critical Findings & Evidence mit Signaturen benötigen 2 Approver |
| **Immutability** | Audit-Einträge, Dossier-Snapshots, Signatures sind unveränderlich |
| **Rate Limiting** | Per Tenant & Role; kritische Endpoints: 10 req/min |
| **Tenant Isolation** | Alle Endpunkte durch `:tenantId` isoliert |

---

## Integration mit bestehenden Patterns

### nova-decision-machine (v0.49.0)
- Findings folgen dem Decision Lifecycle: `proposed` → `triaged` → `pending_approval` → `approved` → `applied`
- Mitigations nutzen dasselbe Approval-Chain-Pattern

### Tenant-Quotas (v0.48.4)
```
Governance API Quotas (pro Tenant & Monat):
├─ Matrix Overrides: 100/month (burst: 10/day)
├─ Finding Resolutions: unlimited (read) / 50/month (write)
├─ Evidence Injections: 20/month (with signature: 50/month)
└─ Dossier Exports: 100/month (PDF/HTML combined)
```

### hitl.service (v0.48.1)
- Approver-Rollen konsistent mit HITL-Pattern
- Signature-Requests integrieren mit existierendem Signing-Portal
