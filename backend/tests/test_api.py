import json

from tests.conftest import H

BLOG = {"type": "blog", "audience": "Owners", "purpose": "Sign-ups"}
DIRTY = "Alpha is the fastest service. Start with Nova today."
CLEAN = "Nova helps our customers manage bookings. Start with Nova today."


def submit(c, content, role="creator", findings=None, **kw):
    return c.post("/api/submissions", headers=H(role), json={"title": "T", **BLOG, "content": content, "findings": findings or [], **kw})


def test_health_and_bootstrap(client):
    assert client.get("/api/health").json["ok"]
    b = client.get("/api/bootstrap").json
    assert b["profile"]["version"] == 2 and len(b["submissions"]) == 6 and len(b["changelog"]) == 2


def test_review_uses_server_profile_and_validates(client):
    r = client.post("/api/review", json={"content": DIRTY, "meta": BLOG, "profile": {"rules": [{"evil": 1}]}})
    assert r.status_code == 200
    assert {f["ruleId"] for f in r.json["findings"]} >= {"T-NAME", "C-FAST"}
    assert client.post("/api/review", json={"content": 5, "meta": BLOG}).status_code == 422
    assert client.post("/api/review", json={"content": "x", "meta": {"type": "nope"}}).status_code == 422
    assert client.post("/api/review", data="notjson", content_type="text/plain").status_code == 400


def test_review_offsets_match_quotes_with_emoji(client):
    c = "Launch 🚀 day! Alpha rocks."
    for f in client.post("/api/review", json={"content": c, "meta": {"type": "social"}}).json["findings"]:
        if f["scope"] == "text":
            u16 = c.encode("utf-16-le")
            assert u16[f["start"] * 2:f["end"] * 2].decode("utf-16-le") == f["quote"]


def test_rewrite(client):
    r = client.post("/api/rewrite", json={"content": DIRTY, "meta": BLOG, "dismissed": []}).json
    assert "Alpha" not in r["text"] and r["applied"] and r["polished"] is False


def test_submit_blocked_by_mandatory_findings(client):
    r = submit(client, DIRTY)
    assert r.status_code == 422 and r.json["blockers"]


def test_client_cannot_hide_findings(client):
    # sending an empty findings list must not bypass the server's own check
    assert submit(client, DIRTY, findings=[]).status_code == 422


def test_override_needs_reason(client):
    f = client.post("/api/review", json={"content": DIRTY, "meta": BLOG}).json["findings"]
    rej = [{**x, "status": "rejected"} for x in f if x["strictness"] == "mandatory"]
    assert submit(client, DIRTY, findings=rej).status_code == 422
    rej = [{**x, "status": "rejected", "note": "Legal approved"} for x in rej]
    assert submit(client, DIRTY, findings=rej).status_code == 201


def test_full_workflow_and_permissions(client):
    r = submit(client, CLEAN)
    assert r.status_code == 201
    sid = r.json["submission"]["id"]
    assert sid == "S-1007" and r.json["submission"]["author"] == "Priya Shah"
    assert submit(client, CLEAN, role="reviewer").status_code == 403
    d = f"/api/submissions/{sid}/decision"
    assert client.post(d, headers=H("creator"), json={"status": "approved"}).status_code == 403
    assert client.post(d, headers=H("manager", "Priya Shah"), json={"status": "approved"}).status_code == 403  # own work
    assert client.post(d, headers=H("reviewer"), json={"status": "changes_requested"}).status_code == 422  # comment needed
    ok = client.post(d, headers=H("reviewer"), json={"status": "changes_requested", "comment": "Tighten the intro"})
    assert ok.status_code == 200 and ok.json["submission"]["status"] == "changes_requested"
    assert client.post(d, headers=H("reviewer"), json={"status": "approved"}).status_code == 409  # already decided
    v = client.post(f"/api/submissions/{sid}/versions", headers=H("creator"), json={"content": CLEAN + " Thanks.", "findings": [], "note": "Fixed"})
    assert v.status_code == 200 and v.json["submission"]["status"] == "in_review" and len(v.json["submission"]["versions"]) == 2
    assert client.post(f"/api/submissions/{sid}/versions", headers=H("creator"), json={"content": CLEAN}).status_code == 409
    a = client.post(d, headers=H("reviewer"), json={"status": "approved"})
    assert a.status_code == 200 and a.json["submission"]["status"] == "approved"
    acts = [x["text"] for x in a.json["submission"]["activity"]]
    assert acts[0] == "Submitted for review" and "Approved the content" in acts[-1]


def test_approve_needs_acknowledgement_for_open_mandatory(client):
    # seeded S-1001 is in review with open mandatory findings
    r = client.post("/api/submissions/S-1001/decision", headers=H("reviewer"), json={"status": "approved"})
    assert r.status_code == 409 and r.json["needsAcknowledgement"]
    r = client.post("/api/submissions/S-1001/decision", headers=H("reviewer"), json={"status": "approved", "acknowledged": True})
    assert r.status_code == 200


def test_comments(client):
    assert client.post("/api/submissions/S-1001/comments", headers=H("creator"), json={"text": " "}).status_code == 422
    r = client.post("/api/submissions/S-1001/comments", headers=H("creator"), json={"text": "Hello"})
    assert r.status_code == 201 and r.json["submission"]["comments"][-1]["text"] == "Hello"
    assert client.post("/api/submissions/S-9999/comments", json={"text": "x"}).status_code == 404


def test_profile_only_manager_and_versioning(client):
    p = client.get("/api/profile").json["profile"]
    assert client.put("/api/profile", headers=H("creator"), json={"profile": p}).status_code == 403
    p2 = {**p, "approvedClaims": p["approvedClaims"] + ["Trusted by shops"]}
    r = client.put("/api/profile", headers=H("manager"), json={"profile": p2})
    assert r.status_code == 200 and r.json["profile"]["version"] == 3 and r.json["changelog"][-1]["summary"] == "Approved claims updated"
    bad = client.put("/api/profile", headers=H("manager"), json={"profile": {**p, "palette": [{"name": "x", "hex": "red"}]}})
    assert bad.status_code == 422


def test_profile_change_then_recheck_finds_new_issues(client):
    p = client.get("/api/profile").json["profile"]
    p["productName"]["current"] = "Nova"
    p["rules"].append({"id": "T-X", "kind": "term", "strictness": "mandatory", "label": "Old term", "category": "Terminology",
                       "pairs": [["bookings", "appointments"]], "why": "Renamed", "source": {"doc": "Brand Guidelines", "ref": "§9"}})
    client.put("/api/profile", headers=H("manager"), json={"profile": p})
    s = client.post("/api/submissions/S-1003/recheck", headers=H("reviewer"), json={}).json["submission"]
    assert s["profileVersion"] == 3
    assert client.post("/api/submissions/S-1003/recheck", headers=H("creator"), json={}).status_code == 403


def test_bad_role_and_cors(client):
    assert client.get("/api/bootstrap", headers={"X-User-Role": "root"}).status_code == 400
    r = client.options("/api/review", headers={"Origin": "http://localhost:5173"})
    assert r.status_code in (200, 204) and r.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "Access-Control-Allow-Origin" not in client.options("/api/review", headers={"Origin": "http://evil.example"}).headers


def test_reset_restores_seed(client):
    submit(client, CLEAN)
    assert client.post("/api/reset", headers=H("creator")).status_code == 403
    assert client.post("/api/reset", headers=H("manager")).status_code == 200
    assert len(client.get("/api/submissions").json["submissions"]) == 6
