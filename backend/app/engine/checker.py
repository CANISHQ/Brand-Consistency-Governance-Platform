"""Rule-based brand checker.

This is the reference engine: deterministic checks against the brand profile. It returns the same
Finding shape the frontend renders (see BACKEND_CONTRACT.md), and it is the safety net under the AI layer:
every AI result is validated against, and merged with, these findings.

Finding: id, key, ruleId, label, category, strictness, kind, scope, start, end, quote, suggestion, why,
         source{doc, ref}, confidence, needsHuman, options?, fix?, orSource?
  kind:  "replace" | "advice" | "conflict"        scope: "text" | "image" | "document"
Offsets (start/end) are UTF-16 code units, which is what JavaScript string indices use in the browser.
"""
from __future__ import annotations

import re
from typing import Any

FLAGS = re.ASCII  # \w, \b and \d are ASCII-only, as in JavaScript


def _flags(f: str | None) -> int:
    return FLAGS | (re.IGNORECASE if f and "i" in f else 0)


def word_re(term: str, case_sensitive: bool = False) -> re.Pattern:
    return re.compile(r"(?<![\w-])" + re.escape(term) + r"(?![\w-])", FLAGS | (0 if case_sensitive else re.IGNORECASE))


def lc(s: str) -> str:
    return s.lower()


def norm(s: str) -> str:
    return re.sub(r"[,\s]", "", lc(s))


def cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def match_case(orig: str, repl: str) -> str:
    f = orig[:1]
    if f and f == f.upper() and f != f.lower() and repl[:1] == repl[:1].lower():
        return cap(repl)
    return repl


def context_key(content: str, start: int, end: int) -> str:
    return content[max(0, start - 20): min(len(content), end + 20)].lower()


def utf16_index(text: str, idx: int) -> int:
    """Convert a code-point index into a UTF-16 code-unit index."""
    return len(text[:idx].encode("utf-16-le")) // 2


def _mk(rule: dict, content: str, start: int, end: int, **extra) -> dict:
    quote = content[start:end]
    f = {
        "id": f"{rule['id']}:{start}",
        "key": f"{rule['id']}|{quote.lower()}|{context_key(content, start, end)}",
        "ruleId": rule["id"],
        "label": rule["label"],
        "category": rule["category"],
        "strictness": rule["strictness"],
        "kind": "replace",
        "scope": "text",
        "start": start,
        "end": end,
        "quote": quote,
        "why": rule.get("why"),
        "source": rule.get("source"),
        "confidence": 0.9,
    }
    f.update(extra)
    return f


PRIORITY = {"mandatory": 3, "flexible": 1}


def _prio(f: dict) -> int:
    return 2 if f["kind"] == "conflict" else PRIORITY.get(f["strictness"], 1)


def split_sentence(sentence: str) -> str | None:
    mid = len(sentence) / 2
    best = None
    for sep in (", and ", ", but ", "; ", ", so "):
        i = sentence.find(sep)
        while i != -1:
            if best is None or abs(i - mid) < abs(best[0] - mid):
                best = (i, sep)
            i = sentence.find(sep, i + 1)
    if best is None:
        return None
    i, sep = best
    left = re.sub(r"[.!?]+$", "", sentence[:i].strip())
    right = sentence[i + len(sep):].strip()
    if sep == ", but ":
        right = "But " + right
    return f"{left}. {cap(right)}"


def _product_name(profile: dict) -> str:
    return (profile.get("productName") or {}).get("current") or profile.get("brandName") or "us"


def _run_text_checks(content: str, meta: dict | None, profile: dict) -> list[dict]:
    meta = meta or {}
    out: list[dict] = []
    rules = [r for r in profile.get("rules", []) if not r.get("rewriteOnly")]
    term_rules = [r for r in profile.get("rules", []) if r.get("kind") == "term"]

    for rule in rules:
        kind = rule.get("kind")
        if kind in ("term", "tone"):
            for a, b in rule.get("pairs", []):
                for m in word_re(a, bool(rule.get("caseSensitive"))).finditer(content):
                    f = _mk(rule, content, m.start(), m.end(), suggestion=match_case(m.group(0), b),
                            confidence=0.97 if kind == "term" else 0.74)
                    if kind == "term":
                        other = next(
                            (r2 for r2 in term_rules if r2["id"] != rule["id"]
                             and any(lc(y) == lc(a) or lc(x) == lc(b) for x, y in r2.get("pairs", []))),
                            None,
                        )
                        if other:
                            f["kind"] = "conflict"
                            f["needsHuman"] = True
                            f["confidence"] = 0.5
                            f["options"] = [
                                {"label": f"Follow {rule['source']['doc']}: use “{f['suggestion']}”", "text": f["suggestion"], "source": rule["source"]},
                                {"label": f"Follow {other['source']['doc']}: keep “{m.group(0)}”", "text": None, "source": other["source"]},
                            ]
                            f["why"] = (f"{rule['source']['doc']} says “{m.group(0)}” should be “{f['suggestion']}”, "
                                        f"but {other['source']['doc']} says otherwise. The platform will not guess.")
                    out.append(f)
        elif kind == "claim":
            for p in rule.get("patterns", []):
                for m in re.compile(p["src"], _flags(p.get("flags"))).finditer(content):
                    out.append(_mk(rule, content, m.start(), m.end(), suggestion=p["replacement"], confidence=0.92, orSource=True))
        elif kind == "stat":
            approved = [norm(x) for x in rule.get("approved", [])]
            for m in re.compile(rule["src"], FLAGS | re.IGNORECASE).finditer(content):
                if norm(m.group(0)) in approved:
                    continue
                first = (rule.get("approved") or [""])[0]
                out.append(_mk(rule, content, m.start(), m.end(), suggestion=first, confidence=0.8, orSource=True))
        elif kind == "exclaim":
            n = 0
            for m in re.finditer(r"(\S*?)(!+)", content):
                n += 1
                word, bang = m.group(1), m.group(2)
                if n == 1 and len(bang) == 1:
                    continue
                if n == 1 and len(bang) > 1:
                    out.append(_mk(rule, content, m.start(), m.end(), suggestion=word + "!", confidence=0.85))
                elif n > 1:
                    out.append(_mk(rule, content, m.start(), m.end(), suggestion=word + ".", confidence=0.76))
        elif kind == "caps":
            skip = {"HTTP", "HTTPS", "FAQ", "SEO", "CRM", "SAAS", "NEW"}
            for m in re.finditer(r"\b[A-Z]{4,}\b", content, FLAGS):
                if m.group(0) in skip:
                    continue
                out.append(_mk(rule, content, m.start(), m.end(), suggestion=cap(m.group(0).lower()), confidence=0.72))
        elif kind == "long":
            for m in re.finditer(r"[^.!?\n]+[.!?]*", content):
                words = m.group(0).split()
                if len(words) <= 30:
                    continue
                lead = len(m.group(0)) - len(m.group(0).lstrip())
                start = m.start() + lead
                end = m.start() + len(m.group(0).rstrip())
                split = split_sentence(content[start:end])
                if split:
                    out.append(_mk(rule, content, start, end, suggestion=split, confidence=0.66, needsHuman=True))
                else:
                    out.append(_mk(rule, content, start, end, kind="advice", suggestion="Split this sentence into two shorter ones.", confidence=0.6, needsHuman=True))
        elif kind == "link":
            for m in re.finditer(r"\b(click here|read more|learn more here)\b", content, FLAGS | re.IGNORECASE):
                out.append(_mk(rule, content, m.start(), m.end(), kind="advice",
                               suggestion="Describe the destination, for example “See the setup guide”.", confidence=0.8))
        elif kind == "structure":
            out.extend(_structure_checks(rule, content, meta, profile))

    # Resolve overlaps: keep the highest-priority finding, then the earlier one.
    spans = sorted((f for f in out if f["scope"] == "text"), key=lambda f: (f["start"], -_prio(f)))
    kept: list[dict] = []
    for f in spans:
        last = kept[-1] if kept else None
        if last and f["start"] < last["end"]:
            if _prio(f) > _prio(last):
                kept[-1] = f
            continue
        kept.append(f)
    docs = [f for f in out if f["scope"] != "text"]
    result = kept + docs
    for f in result:
        if "needsHuman" not in f:
            f["needsHuman"] = f["confidence"] < 0.7
    return result


def _structure_checks(rule: dict, content: str, meta: dict, profile: dict) -> list[dict]:
    res: list[dict] = []
    typ = meta.get("type")
    name = _product_name(profile)

    def doc(label, suggestion, fix, ref, confidence=0.68):
        return {
            "id": f"{rule['id']}:{label}", "key": f"{rule['id']}|{label.lower()}", "ruleId": rule["id"], "label": label,
            "category": rule["category"], "strictness": rule["strictness"], "kind": "advice", "scope": "document",
            "quote": "(whole draft)", "suggestion": suggestion, "why": f"Approved {typ} examples follow this pattern.",
            "source": {"doc": "Approved Examples", "ref": ref}, "confidence": confidence, "fix": fix,
        }

    cta = re.compile(r"\b(try " + re.escape(name) + r"|start with " + re.escape(name) +
                     r"|get started|sign up|book a demo|contact us|start today|talk to us)\b", FLAGS | re.IGNORECASE)
    body = content.strip()
    if typ in ("blog", "ad") and body and not cta.search(content):
        res.append(doc("Missing call to action", f"End with a clear next step, for example “Start with {name} today.”",
                       {"type": "append", "text": f"\n\nStart with {name} today."}, "Blog pattern" if typ == "blog" else "Ad pattern"))
    if typ == "email":
        if body and not re.search(r"^subject:", body, re.IGNORECASE | re.MULTILINE):
            res.append(doc("Missing subject line", "Emails open with a short subject line.", {"type": "prepend", "text": "Subject: [Add subject]\n\n"}, "Email pattern"))
        if body and not re.search(r"\b(hi|hello|dear)\b", content[:160], FLAGS | re.IGNORECASE):
            res.append(doc("Missing greeting", "Open with a friendly greeting such as “Hi there,”.", None, "Email pattern"))
    if typ == "social":
        if len(content) > 280:
            res.append(doc("Too long for the channel", "Keep social posts to 280 characters or fewer.", None, "Social pattern"))
        tags = re.findall(r"#\w+", content, FLAGS)
        if len(tags) > 3:
            res.append(doc("Too many hashtags", f"Use three hashtags or fewer (found {len(tags)}).", None, "Social pattern"))
    for d in res:
        if d.get("fix") is None:
            d.pop("fix")
    return res


# ---------- Images ----------
def image_findings(img: dict | None, profile: dict) -> list[dict]:
    if not img:
        return []
    rules = profile.get("imageRules") or {}
    out: list[dict] = []

    def base(rule_id, label, category, key, quote, suggestion, why, source, confidence, rule, **extra):
        f = {
            "id": f"{rule_id}:{key}", "key": f"{rule_id}|{key}", "ruleId": rule_id, "label": label, "category": category,
            "strictness": rules.get(rule, "flexible"), "kind": "advice", "scope": "image", "quote": quote,
            "suggestion": suggestion, "why": why, "source": source, "confidence": confidence, "needsHuman": True, "rule": rule,
        }
        f.update(extra)
        return f

    name = (img.get("name") or "").lower()
    bad = next((a for a in profile.get("deprecatedAssets", []) if a.lower() in name), None)
    approved_logo = (profile.get("approvedAssets") or ["the approved logo"])[0]
    if bad:
        out.append(base("IMG-LOGO", "Old logo", "Visual identity", img.get("name"), img.get("name"),
                        f"Replace it with the approved logo asset, “{approved_logo}”. Please verify the image before publication.",
                        "The file name matches a retired logo asset. Visual analysis can be uncertain, so a person should confirm.",
                        {"doc": "Brand Assets", "ref": "Approved logo"}, 0.7, "logo"))
    if not (img.get("alt") or "").strip():
        out.append(base("IMG-ALT", "Missing alt text", "Access & channel fit", "alt", "(image has no alt text)",
                        "Describe what the image shows in one short sentence.",
                        "Images need alt text so screen-reader users get the same message.",
                        {"doc": "Accessibility Standards", "ref": "Alt text"}, 0.95, "alt", fix={"type": "alt"}, needsHuman=False))
    approved_fonts = [lc(f) for f in profile.get("fonts", [])]
    for font in [s.strip() for s in (img.get("fonts") or "").split(",") if s.strip()]:
        if lc(font) not in approved_fonts:
            out.append(base("IMG-FONT", "Unapproved font", "Visual identity", font, font,
                            f"Use an approved font: {' or '.join(profile.get('fonts', []))}.",
                            f"“{font}” is not in the approved typography list.",
                            {"doc": "Brand Guidelines", "ref": "§5 Typography"}, 0.9, "fonts", needsHuman=False))
    a = img.get("analysis") or {}
    for c in a.get("offPalette") or []:
        pct = int(c["share"] * 100 + 0.5)
        out.append(base("IMG-PALETTE", "Off-palette colour", "Visual identity", c["hex"], c["hex"],
                        f"Dominant colour {c['hex']} (about {pct}% of the image) is far from the brand palette. "
                        f"Nearest brand colour: {c['nearest']['name']} {c['nearest']['hex']}.",
                        "Visual analysis can be uncertain, so this is routed to a person.",
                        {"doc": "Brand Guidelines", "ref": "§4 Colour palette"}, 0.58, "palette", swatch=c["hex"]))
    lc_ = a.get("lowContrast")
    if lc_:
        ratio = f"{float(lc_['ratio']):.1f}"
        out.append(base("IMG-CONTRAST", "Possible low contrast", "Access & channel fit", "contrast", f"{ratio}:1",
                        f"The two main colours have a contrast ratio of {ratio}:1. Aim for at least 3:1 for large text and 4.5:1 for body text.",
                        "Low contrast makes text harder to read. This is an estimate from dominant colours.",
                        {"doc": "Accessibility Standards", "ref": "Contrast"}, 0.55, "palette"))
    for f in out:
        f.pop("rule", None)
    return out


def _review_all(content: str, meta: dict | None, image: dict | None, profile: dict) -> list[dict]:
    content = content or ""
    text = _run_text_checks(content, meta, profile)
    img_text: list[dict] = []
    if image and (image.get("textInImage") or "").strip():
        sub = {**profile, "rules": [r for r in profile.get("rules", []) if r.get("kind") != "structure"]}
        for f in _run_text_checks(image["textInImage"], {"type": "social"}, sub):
            g = dict(f)
            g.pop("start", None)
            g.pop("end", None)
            g.update({
                "scope": "image", "kind": "advice" if f["kind"] == "replace" else f["kind"], "id": f"img-{f['id']}",
                "key": f"img-{f['key']}", "label": f"{f['label']} (in image)",
                "suggestion": f"In the image text, change “{f['quote']}” to “{f.get('suggestion')}”.", "needsHuman": True,
            })
            img_text.append(g)
    order = {"mandatory": 0, "flexible": 1}
    all_f = text + image_findings(image, profile) + img_text
    all_f.sort(key=lambda f: (order.get(f["strictness"], 1), f.get("start", 10 ** 9)))
    return all_f


# ---------- UTF-16 handling ----------
# The browser indexes strings by UTF-16 code unit. To make offsets, lengths and the 20-character context in
# `key` identical to the frontend, the engine runs on a string where every astral character (emoji) is split
# into a surrogate pair, then the result is joined back into normal Unicode.
def to_js(s: str) -> str:
    return "".join(c if ord(c) < 0x10000 else chr(0xD800 + ((ord(c) - 0x10000) >> 10)) + chr(0xDC00 + ((ord(c) - 0x10000) & 0x3FF)) for c in s)


def from_js(s: str) -> str:
    return s.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")


def _back(v):
    if isinstance(v, str):
        return from_js(v)
    if isinstance(v, list):
        return [_back(x) for x in v]
    if isinstance(v, dict):
        return {k: _back(x) for k, x in v.items()}
    return v


def _jsify(v):
    if isinstance(v, str):
        return to_js(v)
    if isinstance(v, list):
        return [_jsify(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsify(x) for k, x in v.items()}
    return v


def run_text_checks(content: str, meta: dict | None, profile: dict) -> list[dict]:
    return _back(_run_text_checks(to_js(content or ""), meta, _jsify(profile)))


def review_all(content: str, meta: dict | None, image: dict | None, profile: dict) -> list[dict]:
    return _back(_review_all(to_js(content or ""), _jsify(meta), _jsify(image), _jsify(profile)))


def rewrite_content(content: str, meta: dict | None, profile: dict, dismissed: set[str] | None = None) -> dict:
    return _back(_rewrite_content(to_js(content or ""), _jsify(meta), _jsify(profile), {to_js(k) for k in (dismissed or set())}))


# ---------- On-brand rewrite ----------
def _rewrite_content(content: str, meta: dict | None, profile: dict, dismissed: set[str] | None = None) -> dict:
    dismissed = dismissed or set()
    findings = [f for f in _run_text_checks(content, meta, profile) if f["key"] not in dismissed]
    applicable = [f for f in findings if f["scope"] == "text" and f["kind"] == "replace"]
    skipped = [f for f in findings if f["kind"] == "conflict"]
    text = content
    applied: list[dict] = []
    for f in sorted(applicable, key=lambda f: f["start"], reverse=True):
        text = text[:f["start"]] + (f.get("suggestion") or "") + text[f["end"]:]
        applied.append(f)
    contr = next((r for r in profile.get("rules", []) if r.get("id") == "V-CONTR"), None)
    if contr:
        for a, b in contr.get("pairs", []):
            def sub(m, a=a, b=b):
                rep = match_case(m.group(0), b)
                applied.append({"id": f"{contr['id']}:{a}", "label": contr["label"], "quote": m.group(0), "suggestion": rep,
                                "ruleId": contr["id"], "strictness": "flexible"})
                return rep
            text = word_re(a).sub(sub, text)
    for f in _run_text_checks(text, meta, profile):
        if f["scope"] == "document" and f.get("fix"):
            fx = f["fix"]
            text = re.sub(r"\s+$", "", text) + fx["text"] if fx["type"] == "append" else fx["text"] + text
            applied.append({"id": f["id"], "label": f["label"], "quote": "(whole draft)", "suggestion": fx["text"].strip(),
                            "ruleId": f["ruleId"], "strictness": f["strictness"]})
    applied.reverse()
    return {"text": text, "applied": applied, "skipped": skipped}


# ---------- Profile health ----------
def find_conflicts(profile: dict) -> list[dict]:
    rules = [r for r in profile.get("rules", []) if r.get("kind") == "term"]
    out = []
    for i in range(len(rules)):
        for j in range(i + 1, len(rules)):
            pairs_a: list = []
            pairs_b: list = []
            term = None
            for pa in rules[i].get("pairs", []):
                for pb in rules[j].get("pairs", []):
                    if lc(pa[1]) == lc(pb[0]) or lc(pb[1]) == lc(pa[0]):
                        if pa not in pairs_a:
                            pairs_a.append(pa)
                        if pb not in pairs_b:
                            pairs_b.append(pb)
                        term = term or (pa[1] if lc(pa[1]) == lc(pb[0]) else pb[1])
            if pairs_a:
                out.append({"a": rules[i], "b": rules[j], "term": term, "pairsA": pairs_a, "pairsB": pairs_b})
    return out
