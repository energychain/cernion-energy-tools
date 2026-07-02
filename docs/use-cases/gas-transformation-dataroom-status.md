# Gas Transformation Dataroom Status

Issue #365 first slice exposes a read-only, dossier-safe status contract for a
long-lived Gasnetz-Transformationsdatenraum.

The implemented slice is intentionally narrow:

- action: `dashboard-api.gasTransformationDataroomStatus`
- route: `GET /api/dashboard/gas-transformation-dataroom`
- capability key: `gas_transformation_dataroom_status`
- safety: `read_only`

The status snapshot may describe room identity, mandate or network profile,
transformation paths, scenario references, evidence register status, decision
log status, roadmap/review status, owner/reviewer hints, missing evidence,
positive follow-ups and side-effect guards.

This slice does not implement a persistence platform. The following names are
contract terms for later platform cuts:

- `network_profile`
- `transformation_path`
- `asset_group`
- `scenario_version`
- `evidence_item`
- `decision_log`
- `roadmap_item`
- `review_snapshot`

Recommended future namespaces stay tenant-isolated and room-scoped:

- `tenant:<tenantId>:gas_transformation_rooms`
- `tenant:<tenantId>:gas_transformation_paths`
- `tenant:<tenantId>:gas_transformation_evidence`
- `tenant:<tenantId>:gas_transformation_decisions`
- `tenant:<tenantId>:gas_transformation_roadmap`

The first slice does not write Object-Store documents, ingest Knowledge-RAG
sources, promote tenant knowledge, create review snapshots, mutate ACL/export
or archive state, persist EOG scenario versions, approve investments, perform
legal or regulatory determinations, execute gas-grid actions, create HITL items,
send communications or add Personal-Agent shortcuts.
