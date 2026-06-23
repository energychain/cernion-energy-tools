# Stadtwerk Mauer Blended MaStR Data Overlay

## Product Cut

Stadtwerk Mauer uses a blended real-data model:

- public MaStR assets for Mauer are read as the baseline
- original MaStR values and real-world grid-operator provenance remain visible
- `Stadtwerk Mauer` is applied only as a virtual tenant, role and process operator
- the real-world operator hint remains `Syna GmbH`

## Delivered Boundary

- `stadtwerk-mauer-mastr-data-overlay.getStatus`
- `dashboard-api.stadtwerkMauerMastrDataOverlayStatus`
- REST aliases:
  - `GET /api/dashboard/stadtwerk-mauer-mastr-data-overlay`
  - `GET /api/stadtwerk-mauer/mastr-data-overlay/status`
- Capability Broker route: `stadtwerk_mauer_mastr_data_overlay`
- Evidence Registry key: `stadtwerk_mauer_mastr_data_overlay`
- Dossier hydration rule: `dashboard-api.stadtwerkMauerMastrDataOverlayStatus`

## Safety

The overlay is read-only. It does not mutate MaStR, trigger MaKo, execute device control, send customer communication, create HITL tasks, or call external connectors.

Sandbox reset deletes derived runtime artifacts only. It does not delete or rewrite the imported public MaStR baseline.
