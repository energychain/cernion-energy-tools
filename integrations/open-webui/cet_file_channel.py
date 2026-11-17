"""
title: CET Original File Channel
version: 1.2.0
requirements: httpx
Original files enter CET; chat carries references. Download proxy uses the logged-in
Open WebUI user and a dedicated file-channel gateway token. Globally enable on v0.11.3;
MODEL_IDS limits both hooks to the configured CET assistants. TENANT_ROUTES adds further
assistants of other tenants, each with its own gateway token and organization.
"""
import asyncio
import base64
import inspect
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field


TRANSFER_DENIED = "Dateiübertragung abgewiesen."
ORG_PATTERN = r"[A-Za-z0-9_.:-]{1,200}"


async def resolved(value):
    return await value if inspect.isawaitable(value) else value


class Filter:
    class Valves(BaseModel):
        CET_URL: str = Field(default="http://cet:3000")
        GATEWAY_TOKEN: str = Field(default="")
        MODEL_IDS: str = Field(default="cernion-governance-assistant", description="Comma-separated exact model IDs")
        OPENWEBUI_ORG_ID: str = Field(default="")
        TENANT_ROUTES: str = Field(default="", description='JSON {"<model id>": {"GATEWAY_TOKEN": "...", "OPENWEBUI_ORG_ID": "..."}} for assistants of further tenants')
        MAX_BYTES: int = Field(default=10 * 1024 * 1024, gt=0)
        TIMEOUT_SECONDS: int = Field(default=60, gt=0)
        priority: int = Field(default=0)

    def __init__(self):
        self.valves = self.Valves()

    def base_route(self):
        return {"token": self.valves.GATEWAY_TOKEN, "org": self.valves.OPENWEBUI_ORG_ID}

    def tenant_routes(self):
        text = (self.valves.TENANT_ROUTES or "").strip()
        if not text:
            return {}
        try:
            entries = json.loads(text)
        except ValueError:
            raise ValueError("CET-Dateikanal: TENANT_ROUTES ist kein gültiges JSON.") from None
        if not isinstance(entries, dict):
            raise ValueError("CET-Dateikanal: TENANT_ROUTES muss ein Objekt sein.")
        routes = {}
        for model, entry in entries.items():
            token = entry.get("GATEWAY_TOKEN") if isinstance(entry, dict) else None
            org = entry.get("OPENWEBUI_ORG_ID") if isinstance(entry, dict) else None
            # Never echo the entry: it carries a gateway token.
            if not isinstance(token, str) or not token or not isinstance(org, str) or not re.fullmatch(ORG_PATTERN, org):
                raise ValueError("CET-Dateikanal: TENANT_ROUTES-Eintrag unvollständig.")
            routes[str(model).strip()] = {"token": token, "org": org}
        return routes

    def route_for(self, model):
        if not isinstance(model, str):
            return None
        if model in {value.strip() for value in self.valves.MODEL_IDS.split(",") if value.strip()}:
            return self.base_route()
        try:
            return self.tenant_routes().get(model)
        except ValueError:
            # Broken routes fail closed for a model they name; any other model stays a no-op.
            if json.dumps(model) in (self.valves.TENANT_ROUTES or ""):
                raise
            return None

    def route_for_org(self, org):
        # Links without an organization predate tenant routes and belong to the base route.
        if not org or org == self.valves.OPENWEBUI_ORG_ID:
            return self.base_route()
        return next((route for route in self.tenant_routes().values() if route["org"] == org), None)

    def headers(self, user, route=None):
        route = route or self.base_route()
        if not route["token"] or not route["org"]:
            raise ValueError("CET-Dateikanal: Gateway-Schlüssel und Organisation fehlen.")
        headers = {
            "Authorization": "Bearer " + route["token"],
            "X-OpenWebUI-User-Id": str(user["id"]),
        }
        if user.get("email"):
            headers["X-OpenWebUI-User-Email"] = str(user["email"])
        return headers

    async def cet(self, method, path, user, payload=None, route=None):
        # Both targets and credentials are operator valves, never chat/file metadata.
        target = self.valves.CET_URL.rstrip("/")
        if urlsplit(target).scheme not in ("http", "https"):
            raise ValueError("CET-Dateikanal: ungültige Serveradresse.")
        try:
            async with httpx.AsyncClient(timeout=self.valves.TIMEOUT_SECONDS, follow_redirects=False) as client:
                response = await client.request(method, target + path, headers=self.headers(user, route), json=payload)
        except httpx.RequestError:
            raise ValueError("CET-Dateikanal: Server nicht erreichbar oder Zeitüberschreitung.") from None
        if response.status_code >= 400:
            # Only CET's stable safe error message is shown; never request bodies/tokens.
            try:
                message = response.json().get("error", {}).get("message", TRANSFER_DENIED)
                if not isinstance(message, str):
                    message = TRANSFER_DENIED
            except (ValueError, AttributeError):
                message = TRANSFER_DENIED
            raise ValueError("CET-Dateikanal: " + message)
        return response

    def mount_downloads(self, request):
        from fastapi import Depends, HTTPException, Request
        from starlette.responses import Response
        from starlette.routing import Mount
        from open_webui.utils.auth import get_verified_user

        app = request.app
        marker = "cet_file_channel_filter"
        # Hot reload keeps the endpoint but updates valves on the active filter instance.
        setattr(app.state, marker, self)
        if getattr(app.state, "cet_file_channel_route_mounted", False):
            return

        async def download(file_id: str, request: Request, ticket: str, user=Depends(get_verified_user), org: str = ""):
            if not re.fullmatch(r"[a-f0-9]{64}", file_id) or len(ticket) > 2048 or (org and not re.fullmatch(ORG_PATTERN, org)):
                raise HTTPException(status_code=422, detail="Ungültige Dateireferenz.")
            active = getattr(request.app.state, marker)
            from urllib.parse import urlencode
            try:
                route = active.route_for_org(org)
                if not route:
                    raise ValueError("CET-Dateikanal: unbekannte Organisation.")
                response = await active.cet("GET", f"/v1/files/{file_id}/content?" + urlencode({"ticket": ticket, "openWebuiOrgId": route["org"]}), {"id": user.id, "email": getattr(user, "email", None)}, route=route)
            except ValueError as error:
                raise HTTPException(status_code=403, detail=str(error)) from None
            headers = {key: response.headers[key] for key in ("content-disposition", "cache-control", "x-content-type-options") if key in response.headers}
            return Response(response.content, media_type=response.headers.get("content-type", "application/octet-stream"), headers=headers)

        # OWUI's plugin loader exec() inherits postponed annotations. Request is
        # locally imported, so resolve it explicitly before FastAPI inspects it.
        download.__annotations__["request"] = Request
        app.add_api_route("/api/v1/cet-files/{file_id}", download, methods=["GET"], include_in_schema=False)
        # v0.11.3 mounts the frontend at "/" before functions are loaded. A route
        # appended after that catch-all is unreachable. Put the proxy before it.
        routes = app.router.routes
        proxy = routes.pop()
        frontend_index = next((index for index, route in enumerate(routes)
                               if isinstance(route, Mount) and route.path in ("", "/")), len(routes))
        routes.insert(frontend_index, proxy)
        app.state.cet_file_channel_route_mounted = True

    def matches_model(self, body):
        return self.route_for(body.get("model")) is not None

    async def inlet(self, body: dict, __user__: dict, __request__):
        route = self.route_for(body.get("model"))
        if not route:
            return body
        # v0.11.3 re-raises inlet errors and displays chat:message:error. Never
        # catch upload failures and return the original body: that would run RAG.
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
                "openWebuiOrgId": route["org"],
            }, route=route)
            ref = response.json()
            refs.append({key: ref[key] for key in ("fileId", "name", "mimeType", "size", "hash")})
        # Unknown top-level fields survive OWUI's OpenAI forwarding; metadata is internal.
        body["cet_file_refs"] = refs
        body["files"] = []  # Disable the subsequent RAG pipeline for these originals.
        return body

    async def outlet(self, body: dict):
        route = self.route_for(body.get("model"))
        if not route:
            return body
        # Browser downloads keep its OWUI session; the gateway key stays on the server.
        pattern = r"(?:https?://[^\s/)]+)?/v1/files/([a-f0-9]{64})/content\?ticket=([A-Za-z0-9_.-]+)"
        # The organization picks the download route; it is no credential. ORG_PATTERN keeps
        # it free of backslashes, so it is safe inside the replacement template.
        suffix = "" if route["org"] == self.valves.OPENWEBUI_ORG_ID else "&org=" + route["org"]
        replacement = r"/api/v1/cet-files/\1?ticket=\2" + suffix
        for message in body.get("messages", []):
            if message.get("role") == "assistant" and isinstance(message.get("content"), str):
                message["content"] = re.sub(pattern, replacement, message["content"])
        return body
