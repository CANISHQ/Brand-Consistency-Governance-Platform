"""Optional Gemini layer. The rule engine is the source of truth; the model only adds suggestions on top.

Guarantees (enforced in code, not by prompting):
  * the API key never leaves the server
  * only the draft text, audience, brand voice and approved claims are sent. No submissions, names or files
  * the model cannot create a mandatory finding, and cannot make up a source: anything it says that is not
    backed by a real profile document is downgraded to needsHuman with low confidence
  * every quote must appear verbatim in the draft; offsets are computed here, never trusted from the model
  * paragraph rewrites are accepted only if they add no new numbers or claims and introduce no new rule violations
  * any failure (no key, timeout, bad JSON) returns nothing and the rule engine result stands

NOTE: request/response handling is covered by tests with a mocked HTTP layer. It has not been run against the
live Gemini API from this environment.
"""
import json
import re

import requests

from ..engine.checker import from_js, run_text_checks, to_js, word_re  # noqa: F401

HOST = "https://generativelanguage.googleapis.com/v1beta"
CATS = ["Language & tone", "Brand aura", "Facts & claims", "Terminology"]

FINDINGS_SCHEMA = {
    "type": "object",
    "properties": {"findings": {"type": "array", "items": {"type": "object", "properties": {
        "quote": {"type": "string"}, "label": {"type": "string"}, "category": {"type": "string", "enum": CATS},
        "suggestion": {"type": "string"}, "why": {"type": "string"}, "sourceDoc": {"type": "string"},
        "sourceRef": {"type": "string"}, "confidence": {"type": "number"}},
        "required": ["quote", "label", "category", "why", "confidence"]}}},
    "required": ["findings"],
}
REWRITE_SCHEMA = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}


class Gemini:
    def __init__(self, cfg, session=None):
        self.key, self.model, self.style, self.timeout = cfg.gemini_key, cfg.gemini_model, cfg.gemini_style, cfg.gemini_timeout
        self.s = session or requests.Session()

    @property
    def enabled(self):
        return bool(self.key)

    def _json(self, system, prompt, schema):
        h = {"x-goog-api-key": self.key, "Content-Type": "application/json"}
        if self.style == "interactions":
            body = {"model": self.model, "input": f"{system}\n\n{prompt}", "response_format": {"type": "json_schema", "schema": schema}}
            r = self.s.post(f"{HOST}/interactions", headers=h, json=body, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
            text = "".join(c.get("text", "") for st in data.get("steps", []) if st.get("type") == "model_output"
                           for c in st.get("content", []) if c.get("type") == "text")
        else:
            body = {"systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "responseSchema": _gs(schema), "temperature": 0.2}}
            r = self.s.post(f"{HOST}/models/{self.model}:generateContent", headers=h, json=body, timeout=self.timeout)
            r.raise_for_status()
            text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
        return json.loads(text)

    # ---------- extra findings ----------
    def suggest(self, content, meta, profile, existing):
        """Returns validated extra findings (UTF-16 offsets), or [] on any problem."""
        if not self.enabled or not content.strip():
            return []
        sys = ("You are a brand-compliance reviewer. Find wording in the DRAFT that clashes with the brand voice or states "
               "an unsupported claim. Quote the exact words from the draft. Only cite a source if it is one of the "
               "provided approved claims or voice rules. Never invent facts or numbers. Return JSON only.")
        prompt = json.dumps({"brandVoice": profile.get("voice"), "approvedClaims": profile.get("approvedClaims"),
                             "audience": meta.get("audience"), "purpose": meta.get("purpose"), "draft": content}, ensure_ascii=False)
        try:
            raw = self._json(sys, prompt, FINDINGS_SCHEMA)
        except Exception:  # network, HTTP, JSON: fail soft
            return []
        return validate_ai_findings(raw, content, profile, existing)

    # ---------- paragraph rewrite ----------
    def polish(self, text, meta, profile):
        """Smooths already-corrected text for the brand voice. Returns the polished text or None if it fails validation."""
        if not self.enabled or not text.strip():
            return None
        sys = ("Rewrite the text so it sounds " + ", ".join(profile.get("voice", [])) + ". Keep the meaning, audience, call to "
               "action and every fact. Do not add any number, statistic, guarantee or claim. Return JSON only.")
        try:
            out = self._json(sys, json.dumps({"audience": meta.get("audience"), "text": text}, ensure_ascii=False), REWRITE_SCHEMA)
            new = out["text"]
        except Exception:
            return None
        return new if polish_is_safe(text, new, meta, profile) else None


def _gs(schema):
    """generateContent wants an OpenAPI subset: drop keys it rejects."""
    if isinstance(schema, dict):
        return {k: _gs(v) for k, v in schema.items() if k not in ("additionalProperties",)}
    if isinstance(schema, list):
        return [_gs(x) for x in schema]
    return schema


def known_sources(profile):
    docs = {}
    for r in profile.get("rules", []):
        s = r.get("source")
        if s:
            docs[(s["doc"].lower(), s["ref"].lower())] = s
    return docs


def validate_ai_findings(raw, content, profile, existing):
    if not isinstance(raw, dict) or not isinstance(raw.get("findings"), list):
        return []
    js = to_js(content)
    srcs = known_sources(profile)
    taken = [(f["start"], f["end"]) for f in existing if f.get("scope") == "text" and "start" in f]
    out = []
    for i, r in enumerate(raw["findings"][:12]):
        if not isinstance(r, dict) or not isinstance(r.get("quote"), str) or not r["quote"].strip():
            continue
        q = to_js(r["quote"])
        start = js.find(q)
        if start < 0:  # quote must be verbatim: otherwise drop it
            continue
        end = start + len(q)
        if any(start < e and end > s for s, e in taken):
            continue
        sug = r.get("suggestion") if isinstance(r.get("suggestion"), str) and r["suggestion"].strip() else None
        conf = r.get("confidence") if isinstance(r.get("confidence"), (int, float)) else 0.5
        conf = max(0.0, min(1.0, float(conf)))
        src = srcs.get(((r.get("sourceDoc") or "").lower(), (r.get("sourceRef") or "").lower()))
        verified = src is not None
        if not verified:
            conf = min(conf, 0.6)
            src = {"doc": "Unverified AI suggestion", "ref": "No approved source found"}
        cat = r.get("category") if r.get("category") in CATS else "Language & tone"
        f = {"id": f"AI-{i}:{start}", "key": f"AI|{q.lower()}|{js[max(0, start - 20):end + 20].lower()}", "ruleId": "AI-ASSIST",
             "label": str(r.get("label") or "AI suggestion")[:80], "category": cat, "strictness": "flexible",
             "kind": "replace" if sug else "advice", "scope": "text", "start": start, "end": end, "quote": q,
             "suggestion": sug or "Consider rewording this passage.", "why": str(r.get("why") or "")[:400], "source": src,
             "confidence": conf, "needsHuman": (not verified) or conf < 0.7, "ai": True}
        taken.append((start, end))
        out.append(f)
    out = [{k: (from_js(v) if isinstance(v, str) else v) for k, v in f.items()} for f in out]
    return out


NUM = re.compile(r"\d[\d,.]*%?")


def polish_is_safe(before, after, meta, profile):
    if not isinstance(after, str) or not after.strip():
        return False
    if len(after) > max(200, len(before) * 1.6):
        return False
    nums_b = {re.sub(r"[,.]$", "", n) for n in NUM.findall(before)}
    nums_a = {re.sub(r"[,.]$", "", n) for n in NUM.findall(after)}
    if nums_a - nums_b:  # no new numbers
        return False
    mand_before = {f["ruleId"] for f in run_text_checks(before, meta, profile) if f["strictness"] == "mandatory"}
    mand_after = {f["ruleId"] for f in run_text_checks(after, meta, profile) if f["strictness"] == "mandatory"}
    return mand_after <= mand_before
