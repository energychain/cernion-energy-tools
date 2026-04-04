# UI-Contract 14 — Company Entity (v0.20.3)

> **Status:** Active  
> **Backend version:** 0.20.3  
> **Service:** `company.service.js`  
> **OpenAPI tag:** `Companies`  
> **Base path:** `/api/companies`  
> **Auth:** Read endpoints — `read-only` or `full-access` token. Write endpoints — `full-access` token required.

---

## Overview

A **company entity** groups multiple BDEW market-partner codes that belong to the same economic unit (Konzernverbund / Stadtwerk). This solves the problem of multi-role utilities — a typical Stadtwerk holds 2–4 BDEW codes covering VNB, Lieferant, MSB, and sometimes BKV or Direktvermarkter roles.

### MARKET_ROLE_ENUM

```
'VNB' | 'ÜNB' | 'MSB' | 'Lieferant' | 'BKV' | 'Direktvermarkter' | 'other'
```

### BDEW Prefix Heuristic (fallback when `roles[]` is empty)

| BDEW prefix | Role assigned |
|-------------|---------------|
| `990x`      | VNB           |
| `991x`      | Lieferant      |
| `992x`      | MSB           |
| `993x`      | BKV           |
| `994x`      | Direktvermarkter |
| other        | other         |

Primary signal is always the explicit `roles[]` array from MCP. The prefix heuristic is a fallback only.

---

## Member Object Shape

```json
{
  "bdewCode": "9900277000000",
  "role": "VNB",
  "legalEntity": "Stadtwerke Heidelberg Netze GmbH",
  "mastrId": "SNB123456789",
  "city": "Heidelberg",
  "postalCode": "69115",
  "active": true
}
```

---

## Endpoints

---

### `POST /api/companies` — Create Company

**Auth:** `full-access`

#### Request Body

```json
{
  "displayName": "Stadtwerke Heidelberg",
  "legalName": "Stadtwerke Heidelberg GmbH",
  "autoDiscover": true,
  "query": "Heidelberg",
  "autoConfirm": false
}
```

| Field          | Type    | Required | Notes |
|----------------|---------|----------|-------|
| `displayName`  | string  | ✅       | 1–120 chars |
| `legalName`    | string  | ❌       | defaults to displayName |
| `members`      | array   | ❌       | explicit member list (when autoDiscover=false) |
| `autoDiscover` | boolean | ❌       | default false. Calls `cernion_market_partners` with `query` |
| `query`        | string  | ⚠️       | required when autoDiscover=true |
| `autoConfirm`  | boolean | ❌       | default false. When true, skip draft and activate immediately |

**Manual create (explicit members):**
```json
{
  "displayName": "Stadtwerke Heidelberg",
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB", "legalEntity": "Stadtwerke Heidelberg Netze GmbH" },
    { "bdewCode": "9910277000001", "role": "Lieferant" }
  ]
}
```

#### Response — Draft (autoDiscover=true, autoConfirm=false)

```json
{
  "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "displayName": "Stadtwerke Heidelberg",
  "legalName": "Stadtwerke Heidelberg GmbH",
  "status": "draft",
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB", "legalEntity": "Stadtwerke Heidelberg Netze GmbH", "mastrId": "SNB123456789", "city": "Heidelberg", "postalCode": "69115", "active": true },
    { "bdewCode": "9910277000001", "role": "Lieferant", "legalEntity": "Stadtwerke Heidelberg GmbH", "mastrId": null, "city": "Heidelberg", "postalCode": "69115", "active": true },
    { "bdewCode": "9920277000002", "role": "MSB", "legalEntity": "Stadtwerke Heidelberg Metering", "mastrId": null, "city": "Heidelberg", "postalCode": "69115", "active": true }
  ],
  "suggestedRoles": [ /* same as members — shown for UI review */ ],
  "createdAt": "2026-04-04T10:00:00.000Z",
  "message": "Draft created. Review suggestedRoles and call PUT /api/companies/3fa85f64.../confirm to activate."
}
```

#### Response — Active (autoConfirm=true or manual members)

Same shape without `suggestedRoles` and `message`. `status: "active"`.

#### Error Cases

| HTTP | Code | Condition |
|------|------|-----------|
| 422  | `VALIDATION_ERROR` | `autoDiscover=true` without `query` |
| 409  | `BDEW_ALREADY_ASSIGNED` | `bdewCode` already belongs to another active company |

---

### `PUT /api/companies/:id/confirm` — Confirm Draft

**Auth:** `full-access`

Transitions `status: "draft" → "active"`. Optionally accepts a `members` override (corrected after UI review).

#### Request Body (optional)

```json
{
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB", "legalEntity": "Stadtwerke Heidelberg Netze GmbH" }
  ]
}
```

Omit `members` to confirm the draft members as-is.

#### Response

```json
{
  "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "displayName": "Stadtwerke Heidelberg",
  "status": "active",
  "members": [ /* confirmed member list */ ],
  "updatedAt": "2026-04-04T10:05:00.000Z"
}
```

#### Error Cases

| HTTP | Code | Condition |
|------|------|-----------|
| 404  | `COMPANY_NOT_FOUND` | Unknown companyId |
| 409  | `COMPANY_NOT_DRAFT` | Company is not in draft status |

---

### `GET /api/companies/:id` — Get Company

**Auth:** `read-only` or `full-access`

#### Response

```json
{
  "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "displayName": "Stadtwerke Heidelberg",
  "legalName": "Stadtwerke Heidelberg GmbH",
  "status": "active",
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB", "legalEntity": "Stadtwerke Heidelberg Netze GmbH", "mastrId": "SNB123456789", "active": true },
    { "bdewCode": "9910277000001", "role": "Lieferant", "legalEntity": "Stadtwerke Heidelberg GmbH", "mastrId": null, "active": true },
    { "bdewCode": "9920277000002", "role": "MSB", "legalEntity": "Stadtwerke Heidelberg Metering", "mastrId": null, "active": true }
  ],
  "createdAt": "2026-04-04T10:00:00.000Z",
  "updatedAt": "2026-04-04T10:05:00.000Z"
}
```

---

### `GET /api/companies` — List Companies

**Auth:** `read-only` or `full-access`

#### Query Parameters

| Param   | Type   | Default    | Notes |
|---------|--------|------------|-------|
| `query` | string | —          | Case-insensitive name search |
| `limit` | number | 10 (max 50) | |
| `status`| string | `active`   | `draft` \| `active` \| `archived` \| `all` |

#### Response

```json
{
  "count": 1,
  "companies": [
    {
      "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "displayName": "Stadtwerke Heidelberg",
      "legalName": "Stadtwerke Heidelberg GmbH",
      "status": "active",
      "members": [ /* member list */ ],
      "createdAt": "2026-04-04T10:00:00.000Z",
      "updatedAt": "2026-04-04T10:05:00.000Z"
    }
  ]
}
```

---

### `PUT /api/companies/:id` — Update Company

**Auth:** `full-access`

Updates `displayName`, `legalName`, and/or replaces the full `members` list. All fields are optional — only send what you want to change.

#### Request Body

```json
{
  "displayName": "Stadtwerke Heidelberg (updated)",
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB", "active": true },
    { "bdewCode": "9910277000001", "role": "Lieferant", "active": false }
  ]
}
```

Setting `active: false` on a member removes it from the BDEW index (the code is freed for reassignment).

#### Response

Full updated company object (same shape as GET).

---

### `DELETE /api/companies/:id` — Archive Company

**Auth:** `full-access`

Soft-delete. Sets `status: "archived"` and frees all BDEW codes for reassignment.

#### Response

```json
{
  "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "archived"
}
```

---

## Enriched `market-partners` Response (v0.20.3)

`GET /api/grid-operations/market-partners?query=Heidelberg` now returns two additional fields per result object:

```json
{
  "results": [
    {
      "bdew": "9900277000000",
      "name": "Stadtwerke Heidelberg Netze GmbH",
      "address": "...",
      "city": "Heidelberg",
      "postalCode": "69115",
      "roles": ["VNB"],
      "mastrIds": { "SNB": "SNB123456789" },
      "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "marketRole": "VNB"
    },
    {
      "bdew": "9910277000001",
      "name": "Stadtwerke Heidelberg GmbH",
      "roles": ["Lieferant"],
      "mastrIds": {},
      "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "marketRole": "Lieferant"
    }
  ],
  "count": 2
}
```

| Field       | Type          | Notes |
|-------------|---------------|-------|
| `companyId` | string \| null | null when BDEW not linked to any company |
| `marketRole`| string        | Always present; derived from `roles[]` + BDEW prefix heuristic. One of MARKET_ROLE_ENUM. |

Enrichment is **non-breaking** — both fields are additive. If the company service is unavailable, enrichment degrades gracefully (fields omitted, original results returned).

---

## Flows

### autoDiscover Draft-Confirm Flow

```
POST /api/companies { autoDiscover: true, query: "Heidelberg" }
  → status: "draft", suggestedRoles: [...]

User reviews suggested members in UI
  → corrects any wrong entries (e.g. removes unrelated "Heidelberger Druckmaschinen")

PUT /api/companies/:id/confirm { members: [...corrected...] }
  → status: "active"
  → BDEW index updated
  → enrichResults now returns companyId for these BDEW codes
```

### Manual Create Flow

```
POST /api/companies {
  displayName: "...",
  members: [
    { bdewCode: "9900277000000", role: "VNB" },
    { bdewCode: "9910277000001" }   ← role auto-assigned by BDEW prefix
  ]
}
  → status: "active" immediately (no draft)
```

---

## Error Codes (reserved for Phase 3)

| Code                 | HTTP | Description |
|----------------------|------|-------------|
| `COMPANY_HAS_NO_VNB` | 404  | `resolveCompanyBdew` called for a company without a VNB-role member (Phase 3 middleware) |
| `COMPANY_NOT_FOUND`  | 404  | Unknown companyId in any endpoint |
| `COMPANY_NOT_DRAFT`  | 409  | confirm called on non-draft company |
| `BDEW_ALREADY_ASSIGNED` | 409 | BDEW code already belongs to another active company |
