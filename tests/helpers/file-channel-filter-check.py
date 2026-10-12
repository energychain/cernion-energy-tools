"""Synthetic Open WebUI contract check; no production files or network."""
import __future__
import asyncio
import copy
import importlib.util
import secrets
import sys
import tempfile
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

root = Path(__file__).resolve().parents[2]
# Use tiny interface doubles so CI needs only stdlib Python, not an OWUI installation.
pydantic = ModuleType("pydantic")
class BaseModel:
    pass
pydantic.BaseModel = BaseModel
pydantic.Field = lambda default=None, **kwargs: default
sys.modules["pydantic"] = pydantic
httpx = ModuleType("httpx")
httpx.AsyncClient = object
httpx.RequestError = type("RequestError", (Exception,), {})
sys.modules["httpx"] = httpx
fastapi = ModuleType("fastapi")
fastapi.Depends = lambda value: value
class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)
fastapi.HTTPException = HTTPException
fastapi.Request = type("Request", (), {})
sys.modules["fastapi"] = fastapi
responses = ModuleType("starlette.responses")
responses.Response = lambda content, **kwargs: SimpleNamespace(content=content, **kwargs)
sys.modules["starlette.responses"] = responses
routing = ModuleType("starlette.routing")
routing.Mount = type("Mount", (), {"path": ""})
sys.modules["starlette.routing"] = routing

def module(name, **attrs):
    value = ModuleType(name)
    value.__dict__.update(attrs)
    sys.modules[name] = value
    return value

async def check():
    spec = importlib.util.spec_from_file_location("cet_filter", root / "integrations/open-webui/cet_file_channel.py")
    source = importlib.util.module_from_spec(spec)
    # v0.11.3 plugin.py exec() inherits future annotations from its loader.
    exec(compile(spec.loader.get_source("cet_filter"), spec.origin, "exec",
                 flags=__future__.annotations.compiler_flag), source.__dict__)
    filter = source.Filter()
    gateway = secrets.token_urlsafe(32)
    filter.valves.GATEWAY_TOKEN = gateway
    filter.valves.OPENWEBUI_ORG_ID = "synthetic-org"
    original = b"synthetic original bytes; formula/layout retained"
    with tempfile.TemporaryDirectory() as directory:
        file_path = Path(directory) / "synthetic.txt"
        file_path.write_bytes(original)
        file = SimpleNamespace(filename="synthetic.txt", path=str(file_path), user_id="person-a")
        user = SimpleNamespace(id="person-a", email="synthetic@example.invalid", role="user")
        module("open_webui.models.files", Files=SimpleNamespace(get_file_by_id=AsyncMock(return_value=file)))
        module("open_webui.models.users", Users=SimpleNamespace(get_user_by_id=AsyncMock(return_value=user)))
        module("open_webui.storage.provider", Storage=SimpleNamespace(get_file=lambda path: path))
        acl = AsyncMock(return_value=False)
        module("open_webui.utils.access_control.files", has_access_to_file=acl)
        verified = object()
        module("open_webui.utils.auth", get_verified_user=verified)
        routes = []
        router = SimpleNamespace(routes=[routing.Mount()])
        def add_api_route(*args, **kwargs):
            routes.append((args, kwargs))
            router.routes.append(SimpleNamespace(path=args[0]))
        app = SimpleNamespace(state=SimpleNamespace(), router=router, add_api_route=add_api_route)
        request = SimpleNamespace(app=app)
        ref = {"fileId": "a" * 64, "name": file.filename, "mimeType": "text/plain", "size": len(original), "hash": "a" * 64}
        calls = []
        async def cet(method, path, who, payload=None):
            calls.append((method, path, who, payload))
            return SimpleNamespace(json=lambda: ref)
        filter.cet = cet
        body = {"model": "cernion-governance-assistant", "files": [{"id": "synthetic-source", "type": "file", "path": "/etc/passwd"}], "messages": [{"role": "user", "content": "Save file"}]}
        output = await filter.inlet(body, {"id": user.id}, request)
        import base64
        assert base64.b64decode(calls[0][3]["contentBase64"]) == original
        assert output["files"] == [] and output["cet_file_refs"] == [ref]
        assert "contentBase64" not in str(output)
        assert len(routes) == 1
        assert router.routes[0].path == "/api/v1/cet-files/{file_id}"
        assert isinstance(router.routes[1], routing.Mount)
        assert routes[0][0][1].__defaults__ == (verified,)
        assert routes[0][0][1].__annotations__["request"] is fastapi.Request
        await filter.inlet({"model": "cernion-governance-assistant", "files": []}, {"id": user.id}, request)
        assert len(routes) == 1
        user.id = "foreign-person"
        try:
            await filter.inlet({"model": "cernion-governance-assistant", "files": [{"id": "synthetic-source"}]}, {"id": user.id}, request)
            raise AssertionError("foreign file ACL bypass")
        except ValueError:
            pass
        assert len(calls) == 1
        user.id = "person-a"
        filter.valves.MAX_BYTES = 2
        try:
            await filter.inlet({"model": "cernion-governance-assistant", "files": [{"id": "synthetic-source"}]}, {"id": user.id}, request)
            raise AssertionError("size limit bypass")
        except ValueError:
            pass
        assert len(calls) == 1
        out = await filter.outlet({"model": "cernion-governance-assistant", "messages": [{"role": "assistant", "content": "[file](/v1/files/" + "a" * 64 + "/content?ticket=abc.def)"}]})
        assert "/api/v1/cet-files/" in out["messages"][0]["content"]
        assert gateway not in str(out)
        # Exact match, including empty MODEL_IDS; both hooks must be true no-ops.
        filter.mount_downloads = lambda _: (_ for _ in ()).throw(AssertionError("foreign model mounted route"))
        for model in ("foreign-model", "cernion-governance-assistant-extra", None):
            foreign = {"model": model, "files": [{"id": "synthetic-source"}], "messages": [{"role": "assistant", "content": "[file](/v1/files/" + "a" * 64 + "/content?ticket=abc.def)"}]}
            before = copy.deepcopy(foreign)
            assert await filter.inlet(foreign, {}, request) is foreign
            assert await filter.outlet(foreign) is foreign
            assert foreign == before
        filter.valves.MODEL_IDS = ""
        assert await filter.inlet(body, {}, request) is body
        filter.valves.MODEL_IDS = " other-assistant, cernion-governance-assistant "
        assert filter.matches_model({"model": "other-assistant"})
        # Identity headers are shared by upload and download; email is optional.
        assert filter.headers({"id": user.id, "email": user.email})["X-OpenWebUI-User-Email"] == user.email
        assert "X-OpenWebUI-User-Email" not in filter.headers({"id": user.id})
        # Exercise the actual mounted proxy with authenticated server-side identity.
        async def download_cet(method, path, who, payload=None):
            assert method == "GET" and who == {"id": user.id, "email": user.email}
            assert "openWebuiOrgId=synthetic-org" in path
            return SimpleNamespace(content=original, headers={"content-type": "text/plain", "cache-control": "no-store"})
        filter.cet = download_cet
        proxy = routes[0][0][1]
        downloaded = await proxy("a" * 64, request, "synthetic.ticket", user)
        assert downloaded.content == original and downloaded.headers["cache-control"] == "no-store"
        async def denied(*args, **kwargs):
            raise ValueError("CET-Dateikanal: Link abgelaufen.")
        filter.cet = denied
        try:
            await proxy("a" * 64, request, "synthetic.ticket", user)
            raise AssertionError("rejected download succeeded")
        except HTTPException as error:
            assert error.status_code == 403
        # A stable 503 must escape inlet without returning files to the text path.
        filter.mount_downloads = lambda _: None
        filter.valves.MAX_BYTES = 1024
        filter.cet = source.Filter.cet.__get__(filter)
        class Client:
            def __init__(self, **kwargs):
                assert kwargs["follow_redirects"] is False
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            async def request(self, method, target, headers, json):
                assert headers["X-OpenWebUI-User-Email"] == user.email
                return SimpleNamespace(status_code=503, json=lambda: {"error": {"message": "Dateikanal-Schlüssel fehlt."}})
        httpx.AsyncClient = Client
        failed_body = {"model": "cernion-governance-assistant", "files": [{"id": "synthetic-source"}]}
        before = copy.deepcopy(failed_body)
        try:
            await filter.inlet(failed_body, {"id": user.id, "email": user.email}, request)
            raise AssertionError("503 silently returned to text path")
        except ValueError as error:
            assert str(error) == "CET-Dateikanal: Dateikanal-Schlüssel fehlt."
        assert failed_body == before
        filter.valves.GATEWAY_TOKEN = ""
        try:
            filter.headers({"id": user.id})
            raise AssertionError("missing valves accepted")
        except ValueError as error:
            assert "Gateway-Schlüssel und Organisation fehlen" in str(error)
        import ast
        tree = ast.parse((root / "integrations/open-webui/cet_file_channel.py").read_text())
        field = next(node for node in ast.walk(tree) if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "GATEWAY_TOKEN")
        assert [keyword.arg for keyword in field.value.keywords] == ["default"]
asyncio.run(check())
