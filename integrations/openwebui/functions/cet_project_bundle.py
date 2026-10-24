"""
title: CET Project Bundle
version: 1.0.0
required_open_webui_version: 0.12.0
requirements: httpx
"""
import asyncio
import hashlib
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import httpx
from pydantic import BaseModel, Field


class Filter:
    class Valves(BaseModel):
        CET_URL: str = Field(default="http://cet:3000")
        GATEWAY_TOKEN: str = Field(default="", json_schema_extra={"input": {"type": "password"}})
        OPENWEBUI_ORG_ID: str = Field(default="")
        MODEL_IDS: str = Field(default="cernion-governance-assistant")
        MAX_BYTES: int = Field(default=2 * 1024**3, gt=0, le=2 * 1024**3)
        TIMEOUT_SECONDS: int = Field(default=120, gt=0)
        POLL_SECONDS: float = Field(default=1, gt=0)
        WAIT_SECONDS: int = Field(default=180, gt=0)
        priority: int = Field(default=-20)

    def __init__(self):
        self.valves = self.Valves()

    async def emit(self, emitter, text, done=False):
        if emitter:
            await emitter({"type": "status", "data": {"description": text, "done": done}})

    async def cet(self, method, route, user, conversation_id, payload=None, content=None):
        target = self.valves.CET_URL.rstrip("/")
        if urlsplit(target).scheme not in ("http", "https") or not self.valves.GATEWAY_TOKEN or not self.valves.OPENWEBUI_ORG_ID:
            raise ValueError("Projektakte: CET-Adresse, Gateway-Schlüssel oder Organisation fehlen.")
        query = {"conversationId": conversation_id, "openWebuiOrgId": self.valves.OPENWEBUI_ORG_ID}
        headers = {"Authorization": "Bearer " + self.valves.GATEWAY_TOKEN, "X-OpenWebUI-User-Id": str(user["id"])}
        if user.get("email"):
            headers["X-OpenWebUI-User-Email"] = str(user["email"])
        if content is not None:
            headers["Content-Type"] = "application/octet-stream"
        path = "/v1/project-bundle/" + route
        path += ("&" if "?" in path else "?") + urlencode(query)
        try:
            async with httpx.AsyncClient(timeout=self.valves.TIMEOUT_SECONDS, follow_redirects=False) as client:
                retry_deadline = time.monotonic() + self.valves.TIMEOUT_SECONDS
                while True:
                    response = await client.request(method, target + path, headers=headers, json=payload, content=content)
                    if response.status_code != 429 or time.monotonic() >= retry_deadline:
                        break
                    try:
                        delay = min(60, max(1, float(response.headers.get("Retry-After", "2"))))
                    except ValueError:
                        delay = 2
                    await asyncio.sleep(delay)
        except httpx.RequestError:
            raise ValueError("Übertragung unterbrochen. Erneut senden setzt bestätigte Chunks fort (innerhalb der Upload-Aufbewahrungsfrist).") from None
        if response.status_code >= 400:
            if response.status_code in (413, 507):
                message = "Die Größen- oder Speichergrenze wurde erreicht. Bündel verkleinern und erneut senden."
            elif response.status_code in (401, 403, 404):
                message = "Kein Zugriff auf diese Projektakte. Nutzerzuordnung und Freigaben prüfen lassen."
            elif response.status_code in (409, 410, 422):
                message = "Datei oder Archiv abgewiesen bzw. Upload abgelaufen. Datei prüfen und erneut senden; bestätigte Chunks bleiben bis zum Ablauf erhalten."
            else:
                message = "Übertragung unterbrochen. Erneut senden setzt bestätigte Chunks fort."
            raise ValueError(message)
        return response.json()

    async def original(self, source_id, user):
        from open_webui.models.files import Files
        from open_webui.storage.provider import Storage
        # Strict ownership: even an OWUI administrator cannot read another person's bytes here.
        record = await Files.get_file_by_id_and_user_id(source_id, user["id"])
        if not record or not record.path:
            raise ValueError("Kein Zugriff auf die Originaldatei.")
        path = Path(await asyncio.to_thread(Storage.get_file, record.path))
        size = (await asyncio.to_thread(path.stat)).st_size
        if not 0 < size <= self.valves.MAX_BYTES:
            raise ValueError("Datei überschreitet die Aufnahmegrenze. Bündel verkleinern und erneut senden.")
        text = (record.data or {}).get("content")
        def digest():
            hasher = hashlib.sha256()
            with path.open("rb") as source:
                for block in iter(lambda: source.read(8 * 1024**2), b""):
                    hasher.update(block)
            return hasher.hexdigest()
        descriptor = {"id": record.id, "name": record.filename, "size": size, "hash": await asyncio.to_thread(digest)}
        if isinstance(text, str):
            descriptor["textHash"] = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()
        return path, descriptor

    async def transfer(self, path, descriptor, user, conversation_id, emitter):
        checksum = descriptor["hash"]
        state = await self.cet("POST", "start", user, conversation_id, {"sourceId": descriptor["id"], "hash": checksum})
        upload_id = state["uploadId"]
        if state.get("status") == "failed":
            raise ValueError("Datei oder Archiv abgewiesen. Original prüfen; erfolgreich übertragene Objekte bleiben erhalten.")
        # The server owns chunk size and the durable missing list; no local resume cache.
        with path.open("rb") as source:
            for index in state["missing"]:
                await asyncio.to_thread(source.seek, index * state["chunkSize"])
                block = await asyncio.to_thread(source.read, state["chunkSize"])
                checksum = hashlib.sha256(block).hexdigest()
                state = await self.cet("PUT", f"uploads/{upload_id}/chunks/{index}?hash={checksum}", user, conversation_id, content=block)
                await self.emit(emitter, f"{descriptor['name']}: {len(state['chunks'])}/{len(state['chunks']) + len(state['missing'])} Teile übertragen.")
        if state.get("ingestState") not in ("complete", "queued", "processing"):
            await self.cet("POST", f"uploads/{upload_id}/complete", user, conversation_id, {})
        return upload_id

    async def inlet(self, body: dict, __user__: dict, __metadata__: dict = None, __event_emitter__=None, __chat_id__=None):
        if body.get("model") not in {s.strip() for s in self.valves.MODEL_IDS.split(",")}:
            return body
        # Ignore transport selectors supplied by the browser; only this hook creates them.
        body.pop("cet_project_bundle", None)
        body.pop("cet_client_context", None)
        metadata = body.setdefault("metadata", __metadata__ or {})
        conversation_id = __chat_id__ or metadata.get("chat_id") or body.get("chat_id")
        if not conversation_id:
            raise ValueError("Projektakte benötigt eine stabile Chat-ID. Bitte einen gespeicherten Chat verwenden.")
        body["cet_client_context"] = {"conversationId": conversation_id, "openWebuiUserId": str(__user__["id"]), "openWebuiOrgId": self.valves.OPENWEBUI_ORG_ID}
        messages = [m for m in body.get("messages", []) if m.get("role") == "user"]
        if not messages or not isinstance(messages[-1].get("content"), str):
            return body
        attachments = metadata.get("files") or body.get("files") or []
        originals = {}
        try:
            for attachment in attachments:
                if attachment.get("type", "file") != "file":
                    continue
                source_id = attachment.get("id") or (attachment.get("file") or {}).get("id")
                originals[source_id] = await self.original(source_id, __user__)
            plan = await self.cet("POST", "prepare", __user__, conversation_id, {"message": messages[-1]["content"], "files": [v[1] for v in originals.values()]})
            if plan["mode"] == "passthrough":
                # Explicit top-level fields survive OWUI's OpenAI router; metadata does not.
                body["metadata"]["conversationId"] = conversation_id
                return body
            if plan["mode"] == "upload":
                await self.emit(__event_emitter__, "Originale werden an die Projektakte übertragen.")
                for descriptor in plan["files"]:
                    if descriptor["id"] not in originals:
                        originals[descriptor["id"]] = await self.original(descriptor["id"], __user__)
                    path, current = originals[descriptor["id"]]
                    if current != {k: descriptor[k] for k in current if k in descriptor}:
                        raise ValueError("Original wurde verändert. Bitte das Bündel erneut anhängen.")
                    await self.transfer(path, current, __user__, conversation_id, __event_emitter__)
                deadline = time.monotonic() + self.valves.WAIT_SECONDS
                while True:
                    result = await self.cet("GET", "result", __user__, conversation_id)
                    if result["done"] or time.monotonic() >= deadline:
                        break
                    await self.emit(__event_emitter__, "Originale empfangen; Struktur und Manifest werden erstellt.")
                    await asyncio.sleep(self.valves.POLL_SECONDS)
                await self.emit(__event_emitter__, result["reply"], done=result["done"])
            # Prevent OWUI from adding extracted text for this batch, including pending consent.
            ids = {d["id"] for d in plan.get("files", [])}
            remaining = [a for a in attachments if (a.get("id") or (a.get("file") or {}).get("id")) not in ids]
            body["files"] = remaining
            metadata["files"] = remaining
            body["cet_project_bundle"] = {"conversationId": conversation_id, "openWebuiUserId": str(__user__["id"]), "openWebuiOrgId": self.valves.OPENWEBUI_ORG_ID}
            return body
        except ValueError as error:
            await self.emit(__event_emitter__, str(error), done=True)
            # Raising stops the request; a failed original must never fall through to text RAG.
            raise
