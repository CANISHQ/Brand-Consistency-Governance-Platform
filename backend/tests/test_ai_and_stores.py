import json

from app import create_app
from app.ai.gemini import Gemini, polish_is_safe, validate_ai_findings
from app.config import Config
from app.engine.checker import review_all
from app.seed import load_seed
from app.store.supabase_store import SupabaseStore
from tests.conftest import H

PROFILE = load_seed()[0]
TXT = "We offer revolutionary synergy for every shop owner. Start with Nova today."


def test_ai_findings_are_validated():
    raw = {"findings": [
        {"quote": "revolutionary synergy", "label": "Buzzwords", "category": "Language & tone", "suggestion": "simple tools",
         "why": "Brand voice is clear", "sourceDoc": "Made Up Doc", "sourceRef": "§1", "confidence": 0.95},
        {"quote": "NOT IN THE DRAFT", "label": "x", "category": "Language & tone", "why": "x", "confidence": 0.9},
        {"quote": "shop owner", "label": "m", "category": "Language & tone", "why": "x", "confidence": 0.9, "strictness": "mandatory",
         "sourceDoc": "Brand Guidelines", "sourceRef": "§3.2 Preferred terms"},
    ]}
    out = validate_ai_findings(raw, TXT, PROFILE, [])
    assert len(out) == 2
    a = out[0]
    assert a["strictness"] == "flexible" and a["needsHuman"] and a["confidence"] <= 0.6  # unverified source is downgraded
    assert TXT[a["start"]:a["end"]] == a["quote"]
    assert out[1]["strictness"] == "flexible" and not out[1]["needsHuman"]  # verified source keeps confidence; never mandatory


def test_ai_overlap_with_rule_finding_dropped():
    existing = review_all("Alpha rocks", {"type": "social"}, None, PROFILE)
    raw = {"findings": [{"quote": "Alpha", "label": "x", "category": "Terminology", "why": "x", "confidence": 0.9}]}
    assert validate_ai_findings(raw, "Alpha rocks", PROFILE, existing) == []


def test_polish_guardrails():
    meta = {"type": "blog"}
    assert polish_is_safe("Nova is great.", "Nova is simply great.", meta, PROFILE)
    assert not polish_is_safe("Nova is great.", "Nova is great, with 99% uptime.", meta, PROFILE)  # new number
    assert not polish_is_safe("Nova is great.", "Alpha is great.", meta, PROFILE)  # new mandatory violation
    assert not polish_is_safe("Nova is great.", "", meta, PROFILE)


class FakeResp:
    def __init__(self, data, status=200):
        self.data, self.status_code, self.text = data, status, json.dumps(data)

    def json(self):
        return self.data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("http")


class FakeSession:
    def __init__(self, data, status=200):
        self.data, self.status, self.calls = data, status, []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append((url, headers, json))
        return FakeResp(self.data, self.status)


def gen(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_gemini_client_request_and_failsoft():
    cfg = Config(gemini_key="k", gemini_model="m1", gemini_style="generate_content")
    fs = FakeSession(gen(json.dumps({"findings": [{"quote": "revolutionary synergy", "label": "B", "category": "Language & tone", "why": "w", "confidence": 0.8}]})))
    out = Gemini(cfg, fs).suggest(TXT, {"audience": "a"}, PROFILE, [])
    url, headers, body = fs.calls[0]
    assert url.endswith("/models/m1:generateContent") and headers["x-goog-api-key"] == "k"
    assert "draft" in body["contents"][0]["parts"][0]["text"] and "key" not in json.dumps(body["contents"]).lower().replace("keyword", "")
    assert len(out) == 1
    assert Gemini(cfg, FakeSession({}, 500)).suggest(TXT, {}, PROFILE, []) == []
    assert Gemini(cfg, FakeSession(gen("not json"))).suggest(TXT, {}, PROFILE, []) == []
    assert Gemini(Config(gemini_key=""), fs).suggest(TXT, {}, PROFILE, []) == []


def test_gemini_interactions_style_parse():
    cfg = Config(gemini_key="k", gemini_style="interactions")
    data = {"steps": [{"type": "model_output", "content": [{"type": "text", "text": json.dumps({"text": "Nova is simply great."})}]}]}
    fs = FakeSession(data)
    assert Gemini(cfg, fs).polish("Nova is great.", {"type": "blog"}, PROFILE) == "Nova is simply great."
    assert fs.calls[0][0].endswith("/interactions")


def test_ai_wired_into_endpoints():
    cfg = Config(sqlite_path=":memory:", gemini_key="k")
    ai = Gemini(cfg, FakeSession(gen(json.dumps({"findings": [{"quote": "revolutionary synergy", "label": "B", "category": "Language & tone", "why": "w", "confidence": 0.8}]}))))
    c = create_app(cfg, ai=ai).test_client()
    r = c.post("/api/review", json={"content": TXT, "meta": {"type": "blog"}}).json
    assert r["engine"] == "rules+ai" and any(f["ruleId"] == "AI-ASSIST" for f in r["findings"])


class FakePostgrest:
    """Minimal in-memory PostgREST for the two tables the store uses."""
    def __init__(self):
        self.t = {"bg_profiles": [], "bg_submissions": []}

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        table = url.rsplit("/", 1)[1]
        rows, p = self.t[table], params or {}
        if method == "GET":
            out = list(rows)
            if "id" in p:
                out = [r for r in out if r["id"] == p["id"][3:]]
            if p.get("order", "").endswith(".desc"):
                key = p["order"].split(".")[0]
                out.sort(key=lambda r: r[key], reverse=True)
            elif p.get("order", "").endswith(".asc"):
                key = p["order"].split(".")[0]
                out.sort(key=lambda r: r[key])
            if "limit" in p:
                out = out[:int(p["limit"])]
            return FakeResp(out)
        if method == "POST":
            pk = "version" if table == "bg_profiles" else "id"
            rows[:] = [r for r in rows if r[pk] != json[pk]] if "on_conflict" in p else rows
            rows.append(json)
            return FakeResp([json], 201)
        if method == "DELETE":
            rows.clear()
            return FakeResp([])


def test_supabase_store_full_workflow_with_fake_http():
    store = SupabaseStore("https://x.supabase.co", "svc", session=FakePostgrest())
    app = create_app(Config(store="supabase", gemini_key="", allow_reset=True), store=store)
    c = app.test_client()
    assert len(c.get("/api/submissions").json["submissions"]) == 6
    r = c.post("/api/submissions", headers=H("creator"), json={"title": "T", "type": "blog", "audience": "a", "purpose": "p",
                                                               "content": "Nova helps customers. Start with Nova today.", "findings": []})
    assert r.status_code == 201 and r.json["submission"]["id"] == "S-1007"
    assert c.post("/api/submissions/S-1007/decision", headers=H("reviewer"), json={"status": "approved"}).json["submission"]["status"] == "approved"
    assert c.get("/api/submissions/S-1007").json["submission"]["status"] == "approved"
    assert c.get("/api/bootstrap").json["profile"]["version"] == 2
