# Koppelpunkt Freigabeakte

## Product cut

`interconnection_release_file` is a read-only evidence/gate capability for Koppelpunkt,
Marktpartner and Zeitreihen mapping decisions. It gives A2MDM and Marktkommunikation
reviewers a dossier-safe view of the mapping subject, evidence source, owner, approval
state, downstream process impact and next change gate.

The first slice is not a mapping system, not a Freigabe workflow and not a cockpit build.
It exposes deterministic read-model rows through:

- `dashboard-api.interconnectionReleaseFileStatus`
- `GET /api/dashboard/interconnection-release-file`
- Evidence Registry key `interconnection_release_file`
- Capability Broker route `interconnection_release_file`
- Answer Dossier hydration rule for the dashboard action

## Inputs

All inputs are optional scalar query parameters. Missing values become explicit evidence
gaps and positive follow-ups.

- `caseId`
- `koppelpunktId`
- `marketPartnerId`
- `timeseriesId`
- `mappingVersion`
- `sourceSystem`
- `evidenceStatus`
- `approvalStatus`
- `owner`
- `affectedProcess`
- `nextChangeGate`

When no mapping evidence is supplied, the endpoint returns synthetic demo/read-model
evidence and labels it as such. It must not claim to hold a real VNB mapping release.

## Output shape

The endpoint returns scalar, render-safe row groups:

- `summaryRows` for release status, owner, version and next gate
- `mappingRows` for Koppelpunkt, Marktpartner and Zeitreihe
- `evidenceRows` for source system, reference, version and confidence
- `approvalRows` for owner/status/open check
- `processImpactRows` for descriptive MaKo, metering, billing, settlement or reporting impact
- `missingEvidence` with `missingDataPoint -> enablesDossierAddition`
- `positiveFollowUps`
- `sourceActions.notCalled`
- `dossierEvidence` for slim Answer Dossier rendering

## Guards

The slice is read-only and non-consequential. It must not perform:

- mapping writes or mapping release execution
- MaKo submission
- billing, settlement, tariff or device-control actions
- HITL ticket creation, workflow execution, webhook or mail
- SMGW/CLS action
- external connector calls
- Budibase table writes
- Personal-Agent hardcoding
- production mutation

## Smoke

Safe DevServer smoke after deployment:

```bash
curl -sS 'http://10.0.0.101:3900/api/dashboard/interconnection-release-file?caseId=smm-koppelpunkt-release-demo&koppelpunktId=KP-SYN-MAUER-01&marketPartnerId=MP-SYN-MAUER-01&timeseriesId=TS-SYN-MAUER-01&mappingVersion=v1&includeFallbacks=true' \
  -H 'X-Tenant-Id: stadtwerk-mauer'
```

Expected shape: HTTP 200, `safety=read_only`, a Freigabeakte `status`, scalar row
arrays, explicit missing evidence when inputs are incomplete, and no-call guards covering
mapping writes, release execution, MaKo, billing, settlement, tariff, HITL/workflow,
webhook/mail, device control, external connector, Budibase write, Personal Agent and
production mutation.
