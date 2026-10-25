"""Runs the complete E2E driver against local OWUI+CET HTTP doubles.
The OWUI double executes the shipped Function against synthetic original storage.
Real CET streaming/storage/ACL/SQL are covered by project-bundle.http.test.js.
"""
import asyncio
import hashlib
import importlib.util
import json
import re
import sys
import threading
import uuid
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType, SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_e2e_driver_local_mock(tmp_path, monkeypatch):
    e2e = load("bundle_e2e", ROOT / "scripts/e2e-openwebui-project-bundle.py")
    plugin = load("bundle_filter", ROOT / "integrations/openwebui/functions/cet_project_bundle.py")
    instance = plugin.Filter()
    functions, originals, objects, chats = {}, {}, {}, {}
    state = {"project": None, "files": [], "removed": []}

    async def get_file(source_id, user_id):
        assert user_id == "person-a"
        return originals.get(source_id)
    for name, values in {
        "open_webui.models.files": {"Files": SimpleNamespace(get_file_by_id_and_user_id=get_file)},
        "open_webui.storage.provider": {"Storage": SimpleNamespace(get_file=lambda path: path)},
    }.items():
        value = ModuleType(name)
        value.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, value)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def route(self):
            path = self.path.split("?")[0]
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            payload = json.loads(raw) if raw and self.headers.get("Content-Type", "").startswith("application/json") else {}
            if path == "/api/v1/auths/signin":
                return self.reply(200, {"id": "person-a", "role": "admin", "token": "synthetic-session"})
            if path.startswith("/api/v1/functions/"):
                if path.endswith("/create"):
                    functions[payload["id"]] = {**payload, "is_active": False, "is_global": False}
                    return self.reply(200, functions[payload["id"]])
                function_id = path.split("/")[5]
                if function_id not in functions:
                    return self.reply(404, {})
                value = functions[function_id]
                if path.endswith("/delete"):
                    del functions[function_id]
                elif path.endswith("/valves/update"):
                    instance.valves = instance.Valves(**payload)
                elif path.endswith("/toggle/global"):
                    value["is_global"] = not value["is_global"]
                elif path.endswith("/toggle"):
                    value["is_active"] = not value["is_active"]
                return self.reply(200, value)
            if path == "/api/v1/files/" and self.command == "POST":
                document = BytesParser(policy=default).parsebytes(b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + raw)
                part = next(document.iter_parts())
                content, name, source_id = part.get_payload(decode=True), part.get_filename(), str(uuid.uuid4())
                stored = tmp_path / source_id
                stored.write_bytes(content)
                originals[source_id] = SimpleNamespace(id=source_id, filename=name, path=str(stored), data={"content": content.decode(errors="replace")})
                return self.reply(200, {"id": source_id})
            if path.startswith("/api/v1/files/") and self.command == "DELETE":
                del originals[path.split("/")[-1]]
                return self.reply(200, True)
            if path == "/api/v1/chats/new":
                chat_id = str(uuid.uuid4())
                chats[chat_id] = payload
                return self.reply(200, {"id": chat_id})
            if path.startswith("/api/v1/chats/"):
                chat_id = path.split("/")[-1]
                if self.command == "DELETE":
                    del chats[chat_id]
                    return self.reply(200, True)
                return self.reply(200, chats[chat_id])
            if path == "/api/chat/completions":
                if not payload.get("files"):
                    return self.reply(200, {"choices": [{"message": {"content": "Die Summe Amount ist 34."}}]})
                statuses = []
                async def emit(event):
                    statuses.append(event["data"])
                request = {**payload, "metadata": {"chat_id": payload["chat_id"], "files": payload["files"]}}
                try:
                    result = asyncio.run(instance.inlet(request, {"id": "person-a"}, __event_emitter__=emit))
                except ValueError:
                    return self.reply(400, {})
                assert not result["metadata"]["files"] and not result["files"], "AC-04: no extracted text enters model request"
                chats[payload["chat_id"]] = {"chat": {"history": {"messages": {payload["id"]: {"statusHistory": statuses}}}}}
                return self.reply(200, {"choices": [{"message": {"content": "Projektakte erstellt. Nicht verarbeitet: unknown.bin."}}], "metadata": {"projectBundle": {"projectId": state["project"]}}})
            if path.startswith("/v1/project-bundle/"):
                assert self.headers["Authorization"] == "Bearer synthetic-gateway"
                assert self.headers["X-OpenWebUI-User-Id"] == "person-a"
                if path.endswith("/prepare"):
                    if not state["project"]:
                        state["project"] = str(uuid.uuid4())
                    state["files"] = payload["files"]
                    return self.reply(200, {"mode": "upload", "projectId": state["project"], "files": state["files"]})
                if path.endswith("/start"):
                    descriptor = next(f for f in state["files"] if f["id"] == payload["sourceId"])
                    existing = next((o for o in objects.values() if o["hash"] == payload["hash"]), None)
                    if not existing:
                        upload_id = str(uuid.uuid4())
                        existing = {**descriptor, "hash": payload["hash"], "uploadId": upload_id, "chunkSize": 65536, "chunks": [], "status": "receiving", "content": {}}
                        objects[upload_id] = existing
                    return self.reply(200, self.status(existing))
                if path.endswith("/result"):
                    return self.reply(200, {"done": all(o["status"] == "received" for o in objects.values()), "projectId": state["project"], "reply": "Projektakte erstellt. Nicht verarbeitet: unknown.bin."})
                match = re.search(r"uploads/([^/]+)(?:/chunks/(\d+)|(/complete))?$", path)
                current = objects[match[1]]
                if match[2] is not None:
                    assert "hash=" + hashlib.sha256(raw).hexdigest() in self.path
                    current["content"][int(match[2])] = raw
                    current["chunks"] = [{"index": i} for i in sorted(current["content"])]
                if match[3]:
                    content = b"".join(current["content"][i] for i in sorted(current["content"]))
                    assert hashlib.sha256(content).hexdigest() == current["hash"]
                    current["status"] = "received"
                    current["ingestState"] = "complete"
                    current["extraction"] = {"status": "extracted"}
                    current["derivation"] = {"datasets": ["synthetic-dataset"]}
                return self.reply(200, self.status(current))
            if path.startswith("/api/project-upload/"):
                return self.reply(200, [{k: v for k, v in o.items() if k != "content"} for o in objects.values()])
            if path.startswith("/api/project-file/") and self.command == "DELETE":
                state["removed"].append(path.split("/")[-1])
                objects.clear()
                return self.reply(200, {"deleted": True})
            if path.startswith("/api/project-manifest/"):
                return self.reply(200, {"summary": {"text": "Synthetic table."}})
            if path == "/api/workbench/skills":
                return self.reply(200, {"items": []})
            if path == "/api/dataset/query":
                return self.reply(200, {"result": [{"sum_Amount": 34}]})
            if path == "/api/workbench/conversations/resolve":
                return self.reply(200, {"found": False})
            self.reply(404, {})

        def status(self, current):
            return {**{k: v for k, v in current.items() if k != "content"}, "missing": [i for i in range((current["size"] + 65535) // 65536) if i not in current["content"]]}
        do_GET = do_POST = do_PUT = do_DELETE = route

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        result = e2e.run({"OWUI_URL": base, "CET_URL": base, "OWUI_USER": "synthetic@example.invalid", "OWUI_PASS": "synthetic-password", "CET_TOKEN": "synthetic-reader", "CET_GATEWAY_TOKEN": "synthetic-gateway", "OWUI_ORG_ID": "synthetic-org", "E2E_RESUME_BYTES": "70000"})
        assert result["statusCount"] >= 2
        assert state["removed"] == [result["projectId"]]
        assert not functions and not originals and not chats and not objects
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
