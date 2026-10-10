"""
title: CET Original File Channel
version: 1.0.0
requirements: httpx
Original files enter CET; chat carries references. Download proxy uses the logged-in
Open WebUI user and the same gateway token as chat. Enable only on the CET assistant.
"""
import asyncio
import base64
import inspect
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field


async def resolved(value):
    return await value if inspect.isawaitable(value) else value


class Filter:
    class Valves(BaseModel):
        CET_URL: str = Field(default="http://cet:3000")
        GATEWAY_TOKEN: str = Field(default="", json_schema_extra={"input": "password"})
        OPENWEBUI_ORG_ID: str = Field(default="")
        MAX_BYTES: int = Field(default=10 * 1024 * 1024, gt=0)
        TIMEOUT_SECONDS: int = Field(default=60, gt=0)
        priority: int = Field(default=0)

    def __init__(self):
        self.valves = self.Valves()

    def headers(self, user):
        if not self.valves.GATEWAY_TOKEN or not self.valves.OPENWEBUI_ORG_ID:
            raise ValueError("CET-Dateikanal: Gateway-Schlüssel und Organisation fehlen.")
        return {
            "Authorization": "Bearer " + self.valves.GATEWAY_TOKEN,
            "X-OpenWebUI-User-Id": str(user["id"]),
        }

    async def cet(self, method, path, user, payload=None):
        # Both targets and credentials are operator valves, never chat/file metadata.
        target = self.valves.CET_URL.rstrip("/")
        if urlsplit(target).scheme not in ("http", "https"):
            raise ValueError("CET-Dateikanal: ungültige Serveradresse.")
        async with httpx.AsyncClient(timeout=self.valves.TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.request(method, target + path, headers=self.headers(user), json=payload)
        if response.status_code >= 400:
            # Only CET's stable safe error message is shown; never request bodies/tokens.
            try:
                message = response.json().get("error", {}).get("message", "Dateiübertragung abgewiesen.")
            except ValueError:
                message = "Dateiübertragung abgewiesen."
            raise ValueError("CET-Dateikanal: " + message)
        return response

    def mount_downloads(self, request):
        from fastapi import Depends, HTTPException, Request
        from starlette.responses import Response
        from open_webui.utils.auth import get_verified_user

        app = request.app
        marker = "cet_file_channel_filter"
        # Hot reload keeps the endpoint but updates valves on the active filter instance.
        setattr(app.state, marker, self)
        if getattr(app.state, "cet_file_channel_route_mounted", False):
            return

        async def download(file_id: str, request: Request, ticket: str, user=Depends(get_verified_user)):
            if not re.fullmatch(r"[a-f0-9]{64}", file_id) or len(ticket) > 2048:
                raise HTTPException(status_code=422, detail="Ungültige Dateireferenz.")
            active = getattr(request.app.state, marker)
            from urllib.parse import urlencode
            try:
                response = await active.cet("GET", f"/v1/files/{file_id}/content?" + urlencode({"ticket": ticket, "openWebuiOrgId": active.valves.OPENWEBUI_ORG_ID}), {"id": user.id})
            except ValueError as error:
                raise HTTPException(status_code=403, detail=str(error)) from None
            headers = {key: response.headers[key] for key in ("content-disposition", "cache-control", "x-content-type-options") if key in response.headers}
            return Response(response.content, media_type=response.headers.get("content-type", "application/octet-stream"), headers=headers)

        app.add_api_route("/api/v1/cet-files/{file_id}", download, methods=["GET"], include_in_schema=False)
        app.state.cet_file_channel_route_mounted = True

    async def inlet(self, body: dict, __user__: dict, __request__):
        self.mount_downloads(__request__)
        attached = body.get("files", [])
        if not attached:
            return body
        from open_webui.models.files import Files
        from open_webui.models.users import Users
        from open_webui.storage.provider import Storage
        from open_webui.utils.access_control.files import has_access_to_file

        user = await resolved(Users.get_user_by_id(__user__["id"]))
        refs = []
        if len(attached) > 16:
            raise ValueError("CET-Dateikanal: höchstens 16 Dateien pro Anfrage.")
        for attachment in attached:
            if attachment.get("type", "file") != "file":
                raise ValueError("CET-Dateikanal: Wissenssammlungen als Dateien nicht unterstützt.")
            # Ignore user-provided paths; only the server's authorized file record owns paths.
            source_id = attachment.get("id") or attachment.get("file", {}).get("id")
            file = await resolved(Files.get_file_by_id(source_id))
            if not file or not user or (file.user_id != user.id and user.role != "admin" and not await resolved(has_access_to_file(source_id, "read", user))):
                raise ValueError("CET-Dateikanal: kein Zugriff auf die Originaldatei.")
            stored_path = Path(await asyncio.to_thread(Storage.get_file, file.path))
            def read_bounded(stored_path=stored_path):
                with stored_path.open("rb") as source:
                    content = source.read(self.valves.MAX_BYTES + 1)
                if len(content) > self.valves.MAX_BYTES:
                    raise ValueError("CET-Dateikanal: Datei überschreitet die Größengrenze.")
                return content
            content = await asyncio.to_thread(read_bounded)
            response = await self.cet("POST", "/v1/files", __user__, {
                "name": file.filename,
                "contentBase64": base64.b64encode(content).decode("ascii"),
                "openWebuiOrgId": self.valves.OPENWEBUI_ORG_ID,
            })
            ref = response.json()
            refs.append({key: ref[key] for key in ("fileId", "name", "mimeType", "size", "hash")})
        # Unknown top-level fields survive OWUI's OpenAI forwarding; metadata is internal.
        body["cet_file_refs"] = refs
        body["files"] = []  # Disable the subsequent RAG pipeline for these originals.
        return body

    async def outlet(self, body: dict):
        # Browser downloads keep its OWUI session; the gateway key stays on the server.
        pattern = r"(?:https?://[^\s/)]+)?/v1/files/([a-f0-9]{64})/content\?ticket=([A-Za-z0-9_.-]+)"
        for message in body.get("messages", []):
            if message.get("role") == "assistant" and isinstance(message.get("content"), str):
                message["content"] = re.sub(pattern, r"/api/v1/cet-files/\1?ticket=\2", message["content"])
        return body
