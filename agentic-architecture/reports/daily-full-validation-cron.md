# Daily Full Validation Cron

Generated: 2026-10-10T22:53:52.320Z
Source run: 20261010T192759Z
Issue: #811 Shepherd: täglichen Full-Validation-Lauf mit Tests/OpenAPI/LLM/GitNexus ergänzen

The Shepherd has a dedicated daily full-validation job separate from the 6h improvement loop. It runs the heavy gates without slowing every autonomous iteration.

## Job

- Name: CET Shepherd Daily Full Validation
- Schedule: every day at 02:30
- Script: `cet-shepherd-full-validation.sh`
- Mode: no-agent / script-only
- Active mode applied: yes

## Full-validation environment

- `SHEPHERD_FULL=1`
- `SHEPHERD_VALIDATE_UNIT=1`
- runtime refactoring disabled for the validation-only job
- ticket/issue/main-promotion workers disabled for the validation-only job

## Latest smoke/full status

```
# CET Shepherd Full Validation

Workflow: full-validation-20261010T225348Z
Exit code: 0
Log: /home/clawd/.openclaw/workspace/cernion-energy-tools-shepherd/output/full-validation/logs/full-validation-20261010T225348Z.log
Finished: 2026-10-11T00:53:48+02:00
```

## Output paths

- Status: `/home/clawd/.openclaw/workspace/cernion-energy-tools-shepherd/output/full-validation/latest-status.md`
- Logs: `/home/clawd/.openclaw/workspace/cernion-energy-tools-shepherd/output/full-validation/logs`
