"""Synthetic Open WebUI contract check; no production files or network."""
import asyncio
import importlib.util
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
sys.modules["httpx"] = httpx
fastapi = ModuleType("fastapi")
fastapi.Depends = lambda value: value
fastapi.HTTPException = type("HTTPException", (Exception,), {})
fastapi.Request = type("Request", (), {})
sys.modules["fastapi"] = fastapi
responses = ModuleType("starlette.responses")
responses.Response = object
sys.modules["starlette.responses"] = responses

def module(name, **attrs):
    value = ModuleType(name)
    value.__dict__.update(attrs)
    sys.modules[name] = value
    return value

async def check():
    spec = importlib.util.spec_from_file_location("cet_filter", root / "integrations/open-webui/cet_file_channel.py")
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    filter = source.Filter()
    filter.valves.GATEWAY_TOKEN = "synthetic-gateway"
    filter.valves.OPENWEBUI_ORG_ID = "synthetic-org"
    original = b"synthetic original bytes; formula/layout retained"
    with tempfile.TemporaryDirectory() as directory:
        file_path = Path(directory) / "synthetic.txt"
        file_path.write_bytes(original)
        file = SimpleNamespace(filename="synthetic.txt", path=str(file_path), user_id="person-a")
        user = SimpleNamespace(id="person-a", role="user")
        module("open_webui.models.files", Files=SimpleNamespace(get_file_by_id=AsyncMock(return_value=file)))
        module("open_webui.models.users", Users=SimpleNamespace(get_user_by_id=AsyncMock(return_value=user)))
        module("open_webui.storage.provider", Storage=SimpleNamespace(get_file=lambda path: path))
        acl = AsyncMock(return_value=False)
        module("open_webui.utils.access_control.files", has_access_to_file=acl)
        verified = object()
        module("open_webui.utils.auth", get_verified_user=verified)
        routes = []
        app = SimpleNamespace(state=SimpleNamespace(), add_api_route=lambda *args, **kwargs: routes.append((args, kwargs)))
        request = SimpleNamespace(app=app)
        ref = {"fileId": "a" * 64, "name": file.filename, "mimeType": "text/plain", "size": len(original), "hash": "a" * 64}
        calls = []
        async def cet(method, path, who, payload=None):
            calls.append((method, path, who, payload))
            return SimpleNamespace(json=lambda: ref)
        filter.cet = cet
        body = {"files": [{"id": "synthetic-source", "type": "file", "path": "/etc/passwd"}], "messages": [{"role": "user", "content": "Save file"}]}
        output = await filter.inlet(body, {"id": user.id}, request)
        import base64
        assert base64.b64decode(calls[0][3]["contentBase64"]) == original
        assert output["files"] == [] and output["cet_file_refs"] == [ref]
        assert "contentBase64" not in str(output)
        assert len(routes) == 1
        assert routes[0][0][1].__defaults__ == (verified,)
        await filter.inlet({"files": []}, {"id": user.id}, request)
        assert len(routes) == 1
        user.id = "foreign-person"
        try:
            await filter.inlet({"files": [{"id": "synthetic-source"}]}, {"id": user.id}, request)
            raise AssertionError("foreign file ACL bypass")
        except ValueError:
            pass
        assert len(calls) == 1
        user.id = "person-a"
        filter.valves.MAX_BYTES = 2
        try:
            await filter.inlet({"files": [{"id": "synthetic-source"}]}, {"id": user.id}, request)
            raise AssertionError("size limit bypass")
        except ValueError:
            pass
        assert len(calls) == 1
        out = await filter.outlet({"messages": [{"role": "assistant", "content": "[file](/v1/files/" + "a" * 64 + "/content?ticket=abc.def)"}]})
        assert "/api/v1/cet-files/" in out["messages"][0]["content"]
        assert "synthetic-gateway" not in str(out)
asyncio.run(check())
