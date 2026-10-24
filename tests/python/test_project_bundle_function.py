"""OWUI 0.12.0 interfaces, synthetic storage and transport only."""
import asyncio
import copy
import hashlib
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("bundle_function", ROOT / "integrations/openwebui/functions/cet_project_bundle.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def run(value):
    return asyncio.run(value)


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    instance = module.Filter()
    instance.valves.OPENWEBUI_ORG_ID = "synthetic-org"
    instance.valves.GATEWAY_TOKEN = "synthetic-gateway"
    original = tmp_path / "values.csv"
    original.write_bytes(b"Key,Amount\na,11\nb,23\n")
    record = SimpleNamespace(id="file-a", filename="values.csv", path=str(original), data={"content": "extracted text"})
    files = SimpleNamespace(get_file_by_id_and_user_id=AsyncMock(return_value=record))
    for name, values in {
        "open_webui.models.files": {"Files": files},
        "open_webui.storage.provider": {"Storage": SimpleNamespace(get_file=lambda path: path)},
    }.items():
        stub = ModuleType(name)
        stub.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, stub)
    return instance, files, original


def body():
    return {"model": "cernion-governance-assistant", "metadata": {"chat_id": "chat-a", "files": [{"type": "file", "id": "file-a", "path": "/untrusted"}]}, "messages": [{"role": "user", "content": "Lege eine Projektakte Alpha an"}]}


def test_original_resume_progress_and_context_removal(plugin):
    instance, files, original = plugin
    events, sent = [], []
    data = original.read_bytes()
    async def cet(method, route, user, conversation_id, payload=None, content=None):
        assert user["id"] == "person-a" and conversation_id == "chat-a"
        if route == "prepare":
            descriptor = payload["files"][0]
            assert descriptor["size"] == len(data)
            assert descriptor["textHash"] == hashlib.sha256(b"extracted text").hexdigest()
            return {"mode": "upload", "files": [descriptor]}
        if route == "start":
            assert payload["hash"] == hashlib.sha256(data).hexdigest()
            return {"uploadId": "upload-a", "chunkSize": 8, "chunks": [{"index": 0}], "missing": [1, 2]}
        if method == "PUT":
            sent.append(content)
            assert hashlib.sha256(content).hexdigest() in route
            return {"chunkSize": 8, "chunks": [{"index": i} for i in range(3)], "missing": []}
        if route.endswith("complete"):
            return {}
        return {"done": True, "reply": "Projektakte Alpha. Nicht verarbeitet: unknown.bin."}
    instance.cet = cet
    async def emit(event):
        events.append(event)
    result = run(instance.inlet(body(), {"id": "person-a"}, __event_emitter__=emit))
    assert sent == [data[8:16], data[16:]]
    assert result["files"] == result["metadata"]["files"] == []
    assert result["cet_project_bundle"]["conversationId"] == "chat-a"
    assert events[-1]["data"]["done"]
    assert "unknown.bin" in events[-1]["data"]["description"]
    files.get_file_by_id_and_user_id.assert_awaited_once_with("file-a", "person-a")


def test_small_single_file_keeps_fulltext_and_conversation(plugin):
    instance, _, _ = plugin
    instance.cet = AsyncMock(return_value={"mode": "passthrough"})
    request = body()
    before = copy.deepcopy(request)
    result = run(instance.inlet(request, {"id": "person-a"}))
    assert result["metadata"]["files"] == before["metadata"]["files"]
    assert result["messages"] == before["messages"]
    assert result["cet_client_context"]["conversationId"] == "chat-a"


def test_pending_confirmation_can_load_stored_ids_without_reattachment(plugin):
    instance, _, _ = plugin
    instance.cet = AsyncMock(return_value={"mode": "ask", "files": [{"id": "file-a"}], "reply": "Soll ich das als Projektakte anlegen?"})
    result = run(instance.inlet(body(), {"id": "person-a"}))
    assert result["metadata"]["files"] == []
    assert result["cet_project_bundle"]["openWebuiUserId"] == "person-a"


def test_foreign_owner_denied_even_for_admin(plugin):
    instance, files, _ = plugin
    files.get_file_by_id_and_user_id.return_value = None
    with pytest.raises(ValueError, match="Kein Zugriff"):
        run(instance.inlet(body(), {"id": "person-b", "role": "admin"}))
    files.get_file_by_id_and_user_id.assert_awaited_once_with("file-a", "person-b")


def test_oversize_and_network_error_fail_closed(plugin):
    instance, _, _ = plugin
    instance.valves.MAX_BYTES = 1
    with pytest.raises(ValueError, match="Aufnahmegrenze"):
        run(instance.inlet(body(), {"id": "person-a"}))
    instance.valves.MAX_BYTES = 1000
    instance.cet = AsyncMock(side_effect=ValueError("Übertragung unterbrochen. Erneut senden setzt fort."))
    request = body()
    with pytest.raises(ValueError, match="Erneut senden"):
        run(instance.inlet(request, {"id": "person-a"}))
    assert "cet_project_bundle" not in request


@pytest.mark.parametrize("status, expected", [(413, "Größen"), (422, "Archiv"), (409, "abgelaufen"), (410, "abgelaufen"), (403, "Nutzerzuordnung"), (503, "Erneut senden")])
def test_safe_errors_and_server_owned_credentials(plugin, monkeypatch, status, expected):
    instance, _, _ = plugin
    client_class = httpx.AsyncClient
    def handle(request):
        assert request.headers["authorization"] == "Bearer synthetic-gateway"
        assert request.headers["x-openwebui-user-id"] == "person-a"
        assert "conversationId=chat-a" in str(request.url)
        return httpx.Response(status, json={"error": {"message": "private detail"}})
    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kwargs: client_class(**kwargs, transport=httpx.MockTransport(handle)))
    with pytest.raises(ValueError, match=expected) as error:
        run(instance.cet("POST", "prepare", {"id": "person-a"}, "chat-a", {}))
    assert "private detail" not in str(error.value)


def test_other_model_bypasses_all_calls(plugin):
    instance, _, _ = plugin
    instance.cet = AsyncMock()
    request = body()
    request["model"] = "other"
    assert run(instance.inlet(request, {"id": "person-a"})) == request
    instance.cet.assert_not_called()


def test_browser_cannot_supply_another_persons_bundle_receipt(plugin):
    instance, _, _ = plugin
    instance.cet = AsyncMock(return_value={"mode": "passthrough"})
    request = body()
    request["cet_project_bundle"] = {"conversationId": "foreign", "openWebuiUserId": "person-b"}
    request["cet_client_context"] = {"openWebuiUserId": "person-b"}
    result = run(instance.inlet(request, {"id": "person-a"}))
    assert "cet_project_bundle" not in result
    assert result["cet_client_context"]["openWebuiUserId"] == "person-a"
