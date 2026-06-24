# SMGW Connector Readiness Status

Read-only UI/API contract for a planned §14a SMGW / NES2 / EEBUS connector path.

## Endpoint

`GET /api/dashboard/smgw-connector-readiness`

The endpoint returns `capabilityKey=smgw_connector_readiness_status` with deterministic readiness facts:

```json
{
  "capabilityKey": "smgw_connector_readiness_status",
  "safety": "read_only",
  "status": "needs_connector_evidence",
  "readinessScore": 0.63,
  "connectorReadiness": {
    "integrationScope": "section14a_smgw_control",
    "gatewayClass": "bsi-tr-03109",
    "adapterClass": "openmuc-reference",
    "controlDomainIntent": "dimming-readiness",
    "authBoundary": "bearer_token_and_x_tenant_id",
    "ownerRole": "flex-operations",
    "fallbackReason": "readiness evidence only"
  },
  "missingEvidence": [],
  "positiveFollowUps": [],
  "sourceActions": {
    "notCalled": [
      "smgw.register",
      "smgw.control",
      "taf7.dispatch",
      "mqtt.publish",
      "eebus.bridge",
      "external.connector.call",
      "personal-agent.execute"
    ]
  }
}
```

## Safety Boundary

This contract only reports readiness evidence and blockers. It does not pair gateways, register devices, send TAF-7 or MQTT messages, run EEBUS/OpenMUC/Voltaris adapters, calculate NES2 tariffs, import billing data, create HITL work, read secrets, or perform production connector actions.

## Dossier Use

The Capability Broker routes narrow SMGW/NES2/EEBUS readiness prompts to `dashboard-api.smgwConnectorReadinessStatus`. The Hydration Registry formats status, readiness score, integration scope, adapter class, auth boundary, leading gap, positive follow-up, non-execution reason and side-effect guard into slim Answer Dossier facts.
