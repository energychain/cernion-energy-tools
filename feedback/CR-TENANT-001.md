# CR-TENANT-001: object-store NS_PATTERN für Tenant-Namespaces

## Status: OFFEN (v0.38.0)

## Problem
object-store.service.js akzeptiert nur Namespaces die dem Pattern
[a-z][a-z0-9_]* entsprechen. Tenant-Namespaces der Form
'tenant:stadtwerk-a:cya_profiles' erfüllen dieses Pattern nicht.

## Auswirkung
Im PoC (v0.38.0) sind object-store-Calls für tenant-aware Profile gemockt.
Im Produktivbetrieb mit echten Tenants schlägt object-store.put/get fehl.

## Fix (vor erstem Multi-Tenant-Deployment)
NS_PATTERN in object-store.service.js erweitern auf:
/^[a-z][a-z0-9_]*(:[a-z0-9-]+)*$/
Dies erlaubt 'tenant:stadtwerk-a:cya_profiles' ohne andere
Namespaces zu beeinflussen.

## Betroffene Tests
tenant-context.test.js (gemockt) — kein sofortiger Handlungsbedarf.
