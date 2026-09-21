# CET UI RC2 Implementation Boundary

This directory contains the implementation contracts, fixtures, adapters, specs and handoff material for **#CETReleaseRC2**.

## Goal

RC2 builds the first deterministic CET UI working surface as a static SPA under `apps/cet-ui/`, backed by CET-owned contracts and REST Gateway endpoints.

Implemented UI surfaces in RC2:

- Tagesfläche
- Vorgangsansicht
- Nachweisansicht
- Operationskonsole

Contract-only in RC2:

- Repertoire
- Arbeitsfläche
- Lernkurve
- Beitragspfad

## Non-negotiable boundaries

- User-facing object name is **Vorgang**. `Laufkarte` remains systems and contract language.
- The frontend talks only to the CET REST Gateway, preferably under `/api/ui/v0/...`.
- The frontend must not call Moleculer Actions directly.
- React components must not consume RC1 internal readmodels directly.
- RC1/CET internal objects must pass through a presentation contract before UI rendering.
- Every rendered assertion must carry `granularitaet`.
- Raw operation results without projection are rendered only as `nicht_projiziert`; they have no `aggregatzustand`, no evidence-marker semantics and are not backed assertions.
- Tests and contracts come before wireframes.
- Wireframes are required for Tagesfläche and Vorgangsansicht only.

## CET-state writes allowed in RC2

RC2 is not read-only inside CET. The UI may write CET-owned state when the contract allows it:

- Vorgang/Laufkarte state
- Übernahme / claim
- namentliche Zuweisung
- placeholder-agent assignment
- Freigabeanforderung
- HITL state
- Einfrieren / Nachweisakte
- Zugriffshistorie per user and Vorgang
- Operationskonsole usage audit

External write systems are not connected in RC2 and are not part of this release scope.

## Tenant, role and placeholder-agent model

- A tenant represents a Stadtwerk or energy utility.
- A user belongs to one tenant.
- A user may have multiple tenant-scoped roles.
- A role may be assigned to several people.
- A role may be unassigned to any human user.
- An unassigned role is served by a tenant-scoped placeholder agent.
- Placeholder agents may take HITLs for their role according to the CET policy/contract.
- Mandantenadministration is the end of the escalation/representation chain.

## Contract chain

The UI rendering chain is:

```text
CET readmodel / RC1 object
→ presentation contract
→ interaction projection
→ UI view model
→ React component
```

Forbidden shortcut:

```text
CET internal object / governanceArchitecture / resolutionValue
→ React component
```

## Implementation order

1. CET backend/contracts outside frontend
2. Frontend shared functions/framework
3. Reusable visible UI elements
4. Surface-specific detailspecs
5. Wireframes for Tagesfläche and Vorgangsansicht
6. Implementation/integration gates

## Primary planning artifact

Nextcloud:

`03 Projekte/Cernion/Governance-Decision-Architecture/Release-Change/CETReleaseRC2-Detailplanung.md`
