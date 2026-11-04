# Shepherd Service-Name Extraction Hardening

Generated: 2026-10-10T22:55:09.809Z
Source run: 20261010T192759Z
Issue: #787 Shepherd: Service-Name-Extraktion gegen Parameter- und Feldnamen härten

This handler hardens the Shepherd scan extractor so it prefers actual Moleculer service definitions over arbitrary `name:` fields inside action parameters, schemas, templates or examples.

## Policy

- Prefer `module.exports = { name: '...' }` / top-level service definition names.
- Fall back to the `*.service.js` filename when a candidate is not a plausible Moleculer service name.
- Reject field-like or parameter-like names with uppercase/camelCase, template interpolation, or generic suffixes.

## Suspicious names observed before hardening

- `Erneuerbare-Energien-Gesetz (EEG)`
- `Stadtwerk Mauer`
- `X-Tenant-Id`
- `churn-prediction-${Date.now()}.csv`
- `direktvermarkterName`
- `startDate`
- `tenant-quota`
- `tenantId`
- `tenantId`
- `tenantId`
- `tenantId`
- `ticket`
- `vnbName`

## Operative Shepherd change

- Scan script: `/home/clawd/.openclaw/workspace/cernion-energy-tools-shepherd/bin/run-scan.sh`
- Applied in active mode: yes

## Follow-up

The next Shepherd scan should regenerate `scan-summary.json` without parameter/field names such as `tenantId`, `ticket`, `startDate`, `vnbName` or other camelCase fields appearing as services.
