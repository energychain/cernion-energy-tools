"""The disposable E2E proxy forwards only the fixed project-bundle routes."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("e2e_bundle", ROOT / "scripts" / "e2e-openwebui-project-bundle.py")
E2E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E2E)


def test_bundle_routes_are_forwarded():
    for path in [
        "/v1/project-bundle/prepare",
        "/v1/project-bundle/start",
        "/v1/project-bundle/result",
        "/v1/project-bundle/uploads/up_1-a/complete",
        "/v1/project-bundle/uploads/up_1-a/chunks/12",
        "/v1/project-bundle/uploads/up_1-a",
    ]:
        assert E2E.ROUTE.fullmatch(path), path
    assert E2E.QUERY.fullmatch("conversationId=3f0c6c1e-1d2e-4a8b-9c0d-112233445566&openWebuiOrgId=e2e-org&hash=" + "a" * 64)
    assert E2E.QUERY.fullmatch("")


def test_traversal_and_foreign_routes_are_rejected():
    for path in [
        "/v1/project-bundle/../../api/project-file",
        "/v1/project-bundle/uploads/../../../api/x",
        "/v1/project-bundle/uploads/up/chunks/1/../../x",
        "/v1/project-bundle/%2e%2e/api",
        "/api/project-file",
        "/v1/chat/completions",
    ]:
        assert not E2E.ROUTE.fullmatch(path), path
    for query in ["a=b&../x", "a=b c", "a=<x>", "x=1#frag"]:
        assert not E2E.QUERY.fullmatch(query), query
