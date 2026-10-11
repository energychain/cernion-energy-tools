"""Disposable real Open WebUI v0.11.3 HTTP contract test (CET/provider are doubles).

Run from any directory: python3 integrations/open-webui/file-channel-smoke.py
Requires Docker Compose, Node.js and stdlib Python. Never targets existing services.
"""
import base64
import hashlib
import http.cookiejar
import json
import secrets
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-p", "cet-file-channel-839", "-f",
           str(ROOT / "integrations/open-webui/docker-compose.file-channel.yml")]
MODEL = "cernion-governance-assistant"
ORG = "synthetic-file-channel-org"
GATEWAY = secrets.token_urlsafe(32)
STATE = {"uploads": [], "chats": [], "fail": False}
CSV = subprocess.check_output(["node", "-e",
    "process.stdout.write(require('./scripts/generate-dataset-fixtures').generateDatasetFixture('csv'))"], cwd=ROOT)
FILE_ID = hashlib.sha256(CSV).hexdigest()
REF = {"fileId": FILE_ID, "name": "synthetic.csv", "mimeType": "text/csv",
       "size": len(CSV), "hash": FILE_ID}


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # No credentials, cookies or ticket-bearing URLs in logs.

    def reply(self, status, payload, mime="application/json"):
        data = json.dumps(payload).encode() if mime == "application/json" else payload
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Disposition", 'attachment; filename="synthetic.csv"')
        self.end_headers()
        self.wfile.write(data)

    def identity(self):
        assert self.headers.get("Authorization") == "Bearer " + GATEWAY
        assert self.headers.get("X-OpenWebUI-User-Email") == STATE["email"]
        assert self.headers.get("X-OpenWebUI-User-Id") == STATE["user_id"]

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/v1/models":
            return self.reply(200, {"object": "list", "data": [
                {"id": value, "object": "model", "owned_by": "synthetic"}
                for value in (MODEL, "synthetic-other-assistant")]})
        if parsed.path == f"/v1/files/{FILE_ID}/content":
            self.identity()
            query = parse_qs(parsed.query)
            if query.get("ticket") != ["synthetic.valid"] or query.get("openWebuiOrgId") != [ORG]:
                return self.reply(403, {"error": {"message": "Link oder Organisation abgewiesen."}})
            STATE["downloaded"] = True
            return self.reply(200, CSV, "text/csv")
        self.reply(404, {})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if self.path == "/v1/files":
            self.identity()
            assert payload["openWebuiOrgId"] == ORG
            assert base64.b64decode(payload["contentBase64"]) == CSV
            STATE["uploads"].append(payload)
            if STATE["fail"]:
                return self.reply(503, {"error": {"message": "Dateikanal-Schlüssel fehlt."}})
            return self.reply(200, REF)
        if self.path == "/v1/chat/completions":
            STATE["chats"].append(payload)
            return self.reply(200, {"id": "synthetic-completion", "object": "chat.completion",
                "created": 0, "model": payload["model"], "choices": [{"index": 0,
                "message": {"role": "assistant", "content": f"[synthetic.csv](/v1/files/{FILE_ID}/content?ticket=synthetic.valid)"},
                "finish_reason": "stop"}], "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})
        self.reply(404, {})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 38390), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    jar = http.cookiejar.CookieJar()
    client = build_opener(HTTPCookieProcessor(jar))
    base = "http://127.0.0.1:30839"

    def call(path, payload=None, raw=None, content_type=None):
        data = raw if raw is not None else json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": content_type or "application/json"} if data is not None else {}
        request = Request(base + path, data=data, headers=headers)
        try:
            with client.open(request, timeout=90) as response:
                content = response.read()
                return response.status, json.loads(content) if "application/json" in response.headers.get("Content-Type", "") else content
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def ok(path, payload=None, **kwargs):
        status, result = call(path, payload, **kwargs)
        assert status == 200, (path, status)  # Never echo sensitive response bodies.
        return result

    try:
        subprocess.run(COMPOSE + ["up", "-d"], check=True)
        for _ in range(180):
            try:
                if call("/health")[0] == 200:
                    break
            except (URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Open WebUI startup timed out")
        # WEBUI_AUTH=False automatically provisions a disposable admin at signin.
        user = ok("/api/v1/auths/signin", {"email": "synthetic@example.invalid", "password": secrets.token_urlsafe(24)})
        STATE.update(email=user["email"], user_id=user["id"])
        ok("/api/v1/functions/create", {"id": "cet_file_channel", "name": "CET Original File Channel",
            "content": (ROOT / "integrations/open-webui/cet_file_channel.py").read_text(), "meta": {"description": "Synthetic contract test"}})
        schema = ok("/api/v1/functions/id/cet_file_channel/valves/spec")
        assert {"CET_URL", "GATEWAY_TOKEN", "OPENWEBUI_ORG_ID", "MODEL_IDS", "MAX_BYTES",
                "TIMEOUT_SECONDS", "priority"} <= schema["properties"].keys()
        assert "input" not in schema["properties"]["GATEWAY_TOKEN"]
        ok("/api/v1/functions/id/cet_file_channel/valves/update", {
            "CET_URL": "http://127.0.0.1:38390", "GATEWAY_TOKEN": GATEWAY,
            "OPENWEBUI_ORG_ID": ORG, "MODEL_IDS": MODEL})
        ok("/api/v1/functions/id/cet_file_channel/toggle", {})
        ok("/api/v1/functions/id/cet_file_channel/toggle/global", {})
        ok("/openai/config/update", {"ENABLE_OPENAI_API": True,
            "OPENAI_API_BASE_URLS": ["http://127.0.0.1:38390/v1"],
            "OPENAI_API_KEYS": ["unused-local-placeholder"], "OPENAI_API_CONFIGS": {}})
        models = ok("/api/models")
        if MODEL not in [model["id"] for model in models["data"]]:
            logs = subprocess.check_output(COMPOSE + ["logs", "--no-color"], text=True)
            print("\n".join(line for line in logs.splitlines() if "Connection error:" in line))
            raise AssertionError("test provider model list unavailable")
        boundary = "synthetic-boundary-839"
        multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\n'.encode()
                     + CSV + f'\r\n--{boundary}--\r\n'.encode())
        uploaded = ok("/api/v1/files/?process=false", raw=multipart, content_type="multipart/form-data; boundary=" + boundary)
        def turn(model=MODEL, files=True):
            return {"model": model, "stream": False, "tools": [],
                "messages": [{"role": "user", "content": "Prüfe die synthetische CSV."}],
                "files": [{"id": uploaded["id"], "type": "file"}] if files else []}
        ok("/api/chat/completions", turn())
        assert len(STATE["uploads"]) == 1
        assert STATE["chats"][-1]["cet_file_refs"] == [REF]
        assert not STATE["chats"][-1].get("metadata", {}).get("files")
        assert "<context>" not in json.dumps(STATE["chats"][-1]["messages"])
        print("PASS: real Files/Users/Storage APIs, email identity, exact original CSV, no RAG")
        STATE["fail"] = True
        count = len(STATE["chats"])
        status, error = call("/api/chat/completions", turn())
        assert status == 400 and error["detail"] == "CET-Dateikanal: Dateikanal-Schlüssel fehlt."
        assert len(STATE["chats"]) == count
        print("PASS: 503 propagated as visible API error; provider never called")
        STATE["fail"] = False
        uploads = len(STATE["uploads"])
        # Unit tests prove unchanged attachments. Here avoid foreign-model RAG/embeddings.
        ok("/api/chat/completions", turn("synthetic-other-assistant", files=False))
        assert len(STATE["uploads"]) == uploads
        print("PASS: global filter ignores other model")
        # Exercise real outlet dispatcher via the explicit API completion endpoint.
        completed = ok("/api/chat/completed", {"model": MODEL, "chat_id": "local:synthetic", "session_id": None,
            "id": "synthetic-message", "messages": [{"id": "synthetic-message", "role": "assistant",
                "content": f"[synthetic.csv](/v1/files/{FILE_ID}/content?ticket=synthetic.valid)"}]})
        assert "/api/v1/cet-files/" in json.dumps(completed)
        status, content = call(f"/api/v1/cet-files/{FILE_ID}?ticket=synthetic.valid")
        assert status == 200, ("proxy status", status, type(content).__name__)
        assert content == CSV, ("proxy bytes", len(content), len(CSV))
        assert STATE.get("downloaded"), "proxy did not call CET"
        # Cookie authentication is exercised, no Authorization header on browser download.
        anonymous = build_opener()
        try:
            anonymous.open(base + f"/api/v1/cet-files/{FILE_ID}?ticket=synthetic.valid")
            raise AssertionError("anonymous download accepted")
        except HTTPError as error:
            assert error.code == 401
        assert call(f"/api/v1/cet-files/{FILE_ID}?ticket=synthetic.expired")[0] == 403
        ok("/api/v1/functions/id/cet_file_channel/valves/update", {
            "CET_URL": "http://127.0.0.1:38390", "GATEWAY_TOKEN": GATEWAY,
            "OPENWEBUI_ORG_ID": "synthetic-foreign-org", "MODEL_IDS": MODEL})
        ok("/api/chat/completions", turn(files=False))  # refresh hot-loaded route instance
        assert call(f"/api/v1/cet-files/{FILE_ID}?ticket=synthetic.valid")[0] == 403
        print("PASS: real outlet, registered proxy, verified session cookie, rejected anonymous/expired/foreign-org")
        print("LIMIT: CET/provider doubled; browser UI, real CET mappings/export/signatures are separate acceptance checks.")
    finally:
        subprocess.run(COMPOSE + ["down", "-v"], check=True)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
