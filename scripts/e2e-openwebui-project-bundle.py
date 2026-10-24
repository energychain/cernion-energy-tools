#!/usr/bin/env python3
"""Explicit opt-in OWUI 0.12.0 E2E. Default --dry-run never contacts a server."""
import argparse
import hashlib
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MODEL = "cernion-governance-assistant"
CSV = b"Key,Amount\na,11\nb,23\n"


class Client:
    def __init__(self, base, token=""):
        self.base, self.token = base.rstrip("/"), token

    def call(self, path, method="GET", payload=None, raw=None, content_type="application/json", allow_error=False):
        data = json.dumps(payload).encode() if payload is not None else raw
        headers = {"Content-Type": content_type}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        try:
            with urlopen(Request(self.base + path, data=data, method=method, headers=headers), timeout=300) as response:
                content = response.read()
                return json.loads(content) if content else None
        except HTTPError as error:
            if allow_error:
                return {"http_error": error.code}
            # Neither credentials nor upstream bodies enter error output.
            raise RuntimeError(f"HTTP {error.code} on {method} {urlsplit(path).path}") from None


class InterruptProxy:
    """Only the Function's project transport crosses this disposable proxy."""
    def __init__(self, target, port=0):
        self.target = target.rstrip("/")
        self.dropped = False
        self.chunks = []
        self.projects = set()
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def handle_request(self):
                size = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(size) if size else None
                path = urlsplit(self.path).path
                if not path.startswith("/v1/project-bundle/"):
                    self.send_error(404)
                    return
                if self.command == "PUT":
                    upload_id, index = path.split("/")[-3], int(path.split("/")[-1])
                    owner.chunks.append((upload_id, index))
                    if index == 1 and not owner.dropped:
                        owner.dropped = True
                        self.connection.shutdown(2)
                        self.connection.close()
                        return
                headers = {k: v for k, v in self.headers.items() if k.lower() in ("authorization", "content-type", "x-openwebui-user-id", "x-openwebui-user-email")}
                try:
                    with urlopen(Request(owner.target + self.path, data=data, headers=headers, method=self.command), timeout=300) as response:
                        body, status, mime = response.read(), response.status, response.headers.get("Content-Type", "application/json")
                except HTTPError as error:
                    body, status, mime = error.read(), error.code, "application/json"
                if path.endswith(("/prepare", "/result")) and status < 300:
                    value = json.loads(body)
                    if value.get("projectId"):
                        owner.projects.add(value["projectId"])
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            do_GET = do_POST = do_PUT = handle_request
        self.server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def upload(owui, name, data, mime):
    boundary = "cet-e2e-" + uuid.uuid4().hex
    raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + f"\r\n--{boundary}--\r\n".encode())
    query = "?process=true&process_in_background=false" if mime.startswith("text/") else "?process=false"
    return owui.call("/api/v1/files/" + query, "POST", raw=raw, content_type="multipart/form-data; boundary=" + boundary)


def run(config):
    owui, cet = Client(config["OWUI_URL"]), Client(config["CET_URL"], config["CET_TOKEN"])
    identity = owui.call("/api/v1/auths/signin", "POST", {"email": config["OWUI_USER"], "password": config["OWUI_PASS"]})
    owui.token = identity["token"]
    if identity.get("role") != "admin":
        raise RuntimeError("OWUI_USER requires admin access to install the Function")
    function_id = config.get("OWUI_FUNCTION_ID") or "cet_project_bundle_e2e_" + uuid.uuid4().hex
    route = "/api/v1/functions/id/" + function_id
    original = owui.call(route, allow_error=True)
    previous = None if original and original.get("http_error") else original
    previous_valves = owui.call(route + "/valves") if previous else None
    proxy = InterruptProxy(config["CET_URL"], int(config.get("E2E_PROXY_PORT", 0)))
    proxy_url = proxy.start()
    public_proxy = config.get("E2E_PROXY_PUBLIC_URL", proxy_url)
    uploaded, chats, cleanup_errors = [], [], []
    try:
        content = (ROOT / "integrations/openwebui/functions/cet_project_bundle.py").read_text()
        function = {"id": function_id, "name": "CET Project Bundle E2E", "content": content, "meta": {"description": "Synthetic #890 validation"}}
        owui.call(route + "/update" if previous else "/api/v1/functions/create", "POST", function)
        owui.call(route + "/valves/update", "POST", {"CET_URL": public_proxy, "GATEWAY_TOKEN": config["CET_GATEWAY_TOKEN"], "OPENWEBUI_ORG_ID": config["OWUI_ORG_ID"], "MODEL_IDS": config.get("OWUI_MODEL", MODEL), "WAIT_SECONDS": 240, "POLL_SECONDS": 2})
        current = owui.call(route)
        for flag, suffix in [("is_active", "/toggle"), ("is_global", "/toggle/global")]:
            if not current.get(flag):
                current = owui.call(route + suffix, "POST", {})
        for name, data, mime in [("values.csv", CSV, "text/csv"), ("notes.txt", b"Synthetic bundle for #890.", "text/plain"), ("unknown.bin", b"x" * int(config.get("E2E_RESUME_BYTES", 9 * 1024**2)), "application/octet-stream")]:
            record = upload(owui, name, data, mime)
            uploaded.append({"type": "file", "id": record["id"], "name": name, "context": "full"})
        chat = owui.call("/api/v1/chats/new", "POST", {"chat": {"title": "Synthetic project bundle", "history": {"messages": {}, "currentId": None}, "messages": []}})
        chats.append(chat["id"])
        title = "Synthetic-" + uuid.uuid4().hex
        message = f'Lege daraus eine Projektakte „{title}“ an.'
        def turn(text, attachments, allow_error=False):
            assistant_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
            user = {"id": user_id, "role": "user", "content": text, "files": attachments}
            response = owui.call("/api/chat/completions", "POST", {"model": config.get("OWUI_MODEL", MODEL), "stream": False, "chat_id": chat["id"], "id": assistant_id, "user_message": user, "messages": [user], "files": attachments, "background_tasks": {"title_generation": False, "tags_generation": False, "follow_up_generation": False}}, allow_error=allow_error)
            return assistant_id, response
        _, interrupted = turn(message, uploaded, True)
        assert proxy.dropped, "No second chunk: increase E2E_RESUME_BYTES beyond CET chunk size"
        assert interrupted.get("http_error") or interrupted.get("error"), "Interrupted request must fail closed"
        assistant_id, response = turn(message, uploaded)
        text = response["choices"][0]["message"]["content"]
        assert "Projektakte" in text and "unknown.bin" in text
        assert "Nicht verarbeitet" in text
        saved = owui.call("/api/v1/chats/" + chat["id"])
        statuses = saved["chat"]["history"]["messages"][assistant_id].get("statusHistory", [])
        assert len(statuses) >= 2 and any(s.get("done") for s in statuses), "Missing chat progress/completion"
        assert len(proxy.projects) == 1, "Retry created a second project"
        project_id = next(iter(proxy.projects))
        manifest = cet.call("/api/project-manifest/" + quote(project_id, safe=""))
        assert manifest.get("summary", {}).get("text"), "Missing manifest completion"
        assert isinstance(cet.call("/api/workbench/skills?projectId=" + quote(project_id, safe="")).get("items"), list)
        records = cet.call("/api/project-upload/" + quote(project_id, safe="") + "/objects")
        table = next(o for o in records if o["name"] == "values.csv")
        assert table["hash"] == hashlib.sha256(CSV).hexdigest()
        assert len([o for o in records if o["name"] == "values.csv"]) == 1
        assert table["extraction"]["status"] == "extracted"
        datasets = table["derivation"]["datasets"]
        answer = cet.call("/api/dataset/query?id=" + quote(datasets[0], safe="") + "&question=Summe%20Amount")
        assert answer["result"] == [{"sum_Amount": 34}], "Table structure/value mismatch"
        _, query = turn("Wie groß ist die Summe der Spalte Amount in values.csv?", [])
        assert "34" in query["choices"][0]["message"]["content"], "Chat answer missing correct table value"
        # AC-04 also inspects the case evidence behind the conversation, not only object counts.
        mapping = cet.call("/api/workbench/conversations/resolve?conversationId=" + quote(chat["id"], safe="") + "&client=open-webui")
        case_id = mapping.get("cetCaseId") or mapping.get("caseId")
        if case_id:
            case = cet.call("/api/workbench/cases/" + quote(case_id, safe="") + "?includeEvidence=true")
            assert not any(e.get("sourceType") == "openwebui_file_ref" and (e.get("sourceRef", {}).get("fileName") == "values.csv" or e.get("label") == "values.csv") for e in case.get("evidenceRefs", [])), "Duplicate full-text evidence"
        else:
            assert response.get("metadata", {}).get("projectBundle"), "Missing project receipt"
        first_chunks = [key for key in proxy.chunks if key[1] == 0]
        assert len(first_chunks) == len(set(first_chunks)), "Confirmed chunks retransmitted"
        print("AC-01..AC-05: passed (originals, chat/table value 34, resume, progress, no duplicate evidence)")
        return {"projectId": project_id, "statusCount": len(statuses)}
    finally:
        def cleanup(call):
            try:
                call()
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
        for project_id in proxy.projects:
            cleanup(lambda project_id=project_id: cet.call("/api/project-file/" + quote(project_id, safe=""), "DELETE"))
        for chat_id in chats:
            cleanup(lambda chat_id=chat_id: owui.call("/api/v1/chats/" + chat_id, "DELETE"))
        for record in uploaded:
            cleanup(lambda record=record: owui.call("/api/v1/files/" + record["id"], "DELETE"))
        if previous:
            cleanup(lambda: owui.call(route + "/update", "POST", {k: previous[k] for k in ("id", "name", "content", "meta")}))
            cleanup(lambda: owui.call(route + "/valves/update", "POST", previous_valves or {}))
            def restore_flags():
                current = owui.call(route)
                for flag, suffix in [("is_active", "/toggle"), ("is_global", "/toggle/global")]:
                    if bool(current.get(flag)) != bool(previous.get(flag)):
                        current = owui.call(route + suffix, "POST", {})
            cleanup(restore_flags)
        else:
            cleanup(lambda: owui.call(route + "/delete", "DELETE"))
        proxy.close()
        if cleanup_errors:
            raise RuntimeError("Cleanup incomplete: " + ", ".join(cleanup_errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.live or args.dry_run:
        print("Dry run: install/restore Function; upload CSV/text/binary; interrupt chunk 1; resend; assert chat progress, sum 34 and no duplicate evidence; cleanup. No network requests.")
        return
    keys = ["OWUI_URL", "OWUI_USER", "OWUI_PASS", "CET_URL", "CET_TOKEN", "CET_GATEWAY_TOKEN", "OWUI_ORG_ID"]
    missing = [k for k in keys if not os.environ.get(k)]
    if missing:
        parser.error("Missing environment variables: " + ", ".join(missing))
    run(dict(os.environ))


if __name__ == "__main__":
    main()
