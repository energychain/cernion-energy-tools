# Knowledge Gateway (Open WebUI knowledge, MVP)

The Knowledge Gateway (`services/knowledge-gateway.service.js`) gives Open WebUI and other CET
clients tenant-safe knowledge bases. Open WebUI never reaches CET storage, vectors, internal
collection names or CET service tokens; it calls the gateway as the OpenAPI tool
`cernion_knowledge_search`.

## Contract

| Endpoint                                                                       | Purpose                                             | Open WebUI gateway token |
| ------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------ |
| `POST /api/workbench/knowledge-bases`                                          | create (owner = authenticated actor)                | no                       |
| `GET /api/workbench/knowledge-bases`                                           | list the bases you may read                         | yes                      |
| `GET/PATCH/DELETE /api/workbench/knowledge-bases/:knowledgeBaseId`             | read / change / delete (owner)                      | no                       |
| `POST /api/workbench/knowledge-bases/:knowledgeBaseId/documents`               | add a document                                      | no                       |
| `GET /api/workbench/knowledge-bases/:knowledgeBaseId/documents[/:documentId]`  | list / status                                       | no                       |
| `DELETE /api/workbench/knowledge-bases/:knowledgeBaseId/documents/:documentId` | delete                                              | no                       |
| `POST …/documents/:documentId/reindex`                                         | rebuild the chunks                                  | no                       |
| `POST /api/workbench/knowledge/search`                                         | search with citations (`cernion_knowledge_search`)  | yes                      |
| `GET /api/workbench/knowledge/citations/:citationId`                           | resolve a citation (access checked again)           | yes                      |
| `GET /api/workbench/knowledge/openapi.json`                                    | tool server document with only the search operation | yes                      |

- **Identity:** `tenantId` and `actorId` come only from the authenticated principal:
  - a normal CET token acts as itself;
  - a gateway token acts for the mapped Open WebUI user (`x-openwebui-user-id` /
    `x-openwebui-user-email` through the existing user mapping, with a delegation audit).
  - Body, prompt and Open WebUI metadata are never authoritative; a differing `tenantId` in the
    body is rejected.
- **IDs:** `kb_…`, `doc_…`, `chk_…` and `cit_…` are opaque. A foreign, unknown or malformed ID
  returns `404`.
- **Visibility:**
  - `private`: owner only;
  - `tenant`: everyone in the tenant;
  - `restricted`: owner plus `acl.actorIds`, `acl.roles` (`ROLE_…`) or `acl.groups`.
  - Only the owner changes a base and its documents.
  - Access is checked before retrieval and again before a result leaves the gateway.
- **Documents:**
  - Input is either a CET file reference (`fileId` from `/v1/files`) or an upload (`name`,
    `mimeType`, `contentBase64`).
  - Validation (type, size, content, scan, tenant and clearance) and text extraction are the file
    channel's.
  - Status values: `queued | extracting | embedding | ready | failed | deleting | deleted`.
  - Versioning: the same `source.externalId` + `source.version` + hash is idempotent. The same
    version with other content is a `409`. A new version replaces the document, and the previous
    chunks stay searchable until the new generation is ready.
  - Deleting acts on search at once and then removes every chunk, paginated.
- **Search:**
  - Without `knowledgeBaseIds`, only bases marked `defaultForChat` that you may read are
    searched.
  - There is no external RAG fallback and no shared default collection.
  - Each result carries the `citationId`, `documentId`, `chunkId`, title, score,
    `location.chunkIndex`/`section` and the source (`type`, `name`, `version`, `sha256`,
    `ingestedAt`).
  - Document content is data, never instructions.

## Connecting Open WebUI

1. Provision the Open WebUI tenant and user mappings as described in
   [open-webui-tenant-gateway.md](open-webui-tenant-gateway.md).
2. In Open WebUI, add a tool server with the URL
   `<CET base>/api/workbench/knowledge/openapi.json`. Use the tenant's gateway token as the bearer,
   and enable forwarding of the user info headers.
3. Release the tool `cernion_knowledge_search` to the pilot group only. The tool loop needs the
   streamed `tool_calls` from `/v1/chat/completions` (see CHANGELOG, "Tool calls in streamed chat
   completions").

Set `CET_PUBLIC_BASE_URL` so the tool document names the server. Data is stored at
`KNOWLEDGE_GATEWAY_DB_PATH` (default `./data/knowledge_gateway`).

## Not in the MVP

Retention and legal hold, deletion receipts, quarantine, OCR diagnostics, connector sync, grace
versions, quotas and cost metrics, an explicit knowledge mode in the OpenAI facade, and
cross-tenant sharing.
