# NOVA Decision Lifecycle Readiness

Issue #70 is cut to a read-only readiness gate for the NOVA TRL-5 to TRL-7 transition.

The first slice exposes `dashboard-api.novaDecisionLifecycleReadinessStatus` and `GET /api/dashboard/nova-decision-lifecycle-readiness`. It evaluates supplied evidence for the lifecycle model, decision source catalogue, transition audit history, tenant-isolated SSE readiness, HITL bridge policy, replay/testability and expiry/non-execution evidence.

The gate is dossier-native: it returns status, risk, readiness score, missing evidence, positive follow-ups, source actions that were not called and slim dossier evidence. It is intended for Capability Broker, Hydration Registry and Answer Dossier consumption through the standard #251 path.

Out of scope: NOVA decision persistence, state-machine execution, approve/reject/apply endpoints, replay endpoints, HITL creation, webhook or SSE emission, asset override, MaStR/Redispatch/threshold mutation, settlement, billing, tariff, device-control, external connectors, secret handling, Personal Agent hardcoding and broad cockpit UI.
