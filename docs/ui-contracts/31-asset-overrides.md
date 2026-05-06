# UI Contract: Asset Overrides

> **Page ID:** `asset-overrides`
> **Version:** 0.44.3
> **Last updated:** 2026-05-06

---

## Primary API Endpoints

- `POST /api/assets/:assetId/override`
- `GET /api/assets/:assetId/overrides`
- `GET /api/assets/:assetId/effective`
- `POST /api/assets/:assetId/overrides/:id/apply`
- `DELETE /api/assets/:assetId/overrides/:id`

**Auth:** Bearer token (`full-access` for mutating endpoints, `read-only` for GET)

---

## 1) Create override

### Request

`POST /api/assets/SEE900123456789/override`

```json
{
  "assetId": "SEE900123456789",
  "field": "capacityKW",
  "value": 1250,
  "reason": "Manual correction from operator",
  "approvedBy": "user"
}
```

### Response shape

```json
{
  "success": true,
  "pendingApproval": false,
  "override": {
    "id": "ovr_SEE900123456789_1a2b3c4d",
    "assetId": "SEE900123456789",
    "mastrNummer": "SEE900123456789",
    "field": "capacityKW",
    "previousValue": 1000,
    "value": 1250,
    "approvalStatus": "approved",
    "approvedBy": "user",
    "approvedAt": "2026-05-06T10:00:00.000Z",
    "supersedes": null,
    "tenantId": "default",
    "provenanceHash": "..."
  }
}
```

### Pending approval behavior

Critical fields (`voltageLevel`, `direktvermarktungActive`) are persisted with:
- `approvalStatus: "pendingApproval"`
- `pendingApproval: true`
- `hitlItemId` set

---

## 2) List overrides

### Request

`GET /api/assets/SEE900123456789/overrides`

### Response shape

```json
{
  "success": true,
  "assetId": "SEE900123456789",
  "count": 2,
  "overrides": [
    {
      "id": "ovr_SEE900123456789_1a2b3c4d",
      "field": "capacityKW",
      "value": 1250,
      "approvalStatus": "approved",
      "supersedesReverted": false,
      "provenanceHash": "..."
    }
  ]
}
```

---

## 3) Effective asset view

### Request

`GET /api/assets/SEE900123456789/effective?gridOperatorId=SNB935578300972&assetType=solar`

### Response shape

```json
{
  "success": true,
  "assetId": "SEE900123456789",
  "sourceTrail": {
    "source": "mastr+overrides",
    "appliedOverrides": [
      {
        "id": "ovr_SEE900123456789_1a2b3c4d",
        "field": "capacityKW",
        "value": 1250,
        "approvalStatus": "approved",
        "provenanceHash": "..."
      }
    ]
  },
  "asset": {
    "Asset-ID": "SEE900123456789",
    "SEE Nummer": "SEE900123456789",
    "Leistung kW": 1250
  }
}
```

---

## 4) Apply pending override

### Request

`POST /api/assets/SEE900123456789/overrides/ovr_SEE900123456789_1a2b3c4d/apply`

### Behavior

- If HITL item is approved, override transitions to `approvalStatus: "approved"`.
- If HITL item is still pending, response returns `pendingApproval: true`.

---

## 5) Soft revert

### Request

`DELETE /api/assets/SEE900123456789/overrides/ovr_SEE900123456789_1a2b3c4d`

### Response shape

```json
{
  "success": true,
  "id": "ovr_SEE900123456789_1a2b3c4d",
  "supersedesReverted": true
}
```

---

## UI rules

- Always display both `Asset-ID` (business ID) and `SEE Nummer` (source identifier).
- Show status badges by `approvalStatus`: `approved`, `pendingApproval`, `rejected`.
- For pending overrides, show action **Apply** only after HITL is approved.
- Display audit metadata (`approvedBy`, `approvedAt`, `reason`, `provenanceHash`).
- Soft-reverted entries remain visible in history (`supersedesReverted=true`).
