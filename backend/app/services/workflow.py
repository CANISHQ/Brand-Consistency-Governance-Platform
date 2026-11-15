"""Approval workflow and server-side rules. Everything the frontend's reducer did, now enforced here.

Rules enforced regardless of what the browser sends:
  * findings are re-run on the server against the stored brand profile; the client cannot hide one
  * a mandatory finding must be fixed, or rejected with a written reason (an override), before submit
  * mandatory findings that need a person (conflicts, uncertain) are routed to the reviewer, not blocked
  * only reviewer/manager decide; nobody decides their own submission; changes/rejection need a comment
  * approving with unresolved or overridden mandatory findings needs explicit acknowledgement
"""
from datetime import datetime, timezone

from ..auth import ApiError
from ..engine.checker import review_all

STATUSES = ("in_review", "changes_requested", "approved", "rejected")
DECISIONS = ("approved", "changes_requested", "rejected")
LABEL = {"approved": "Approved the content", "changes_requested": "Requested changes", "rejected": "Rejected the content"}
KEEP_IMG_RULES = ("IMG-PALETTE", "IMG-CONTRAST")  # need browser-side pixel analysis; the server cannot recompute them


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def light(f: dict) -> dict:
    status = f.get("status") or "open"
    return {
        "key": f["key"], "ruleId": f.get("ruleId"), "label": f.get("label"), "category": f.get("category"),
        "strictness": f.get("strictness", "flexible"), "quote": f.get("quote"), "status": status, "note": f.get("note"),
        "suggestion": f.get("suggestion"), "source": f.get("source"),
        "needsHuman": bool(f.get("needsHuman")) if status == "open" else False,
    }


def _is_blocking(f):  # mandatory, still open, and not something a human reviewer is meant to decide
    return f["strictness"] == "mandatory" and f["status"] == "open" and not f["needsHuman"]


def verified_findings(content, meta, image, profile, client_findings):
    """Re-run the checks and merge the creator's decisions on top. Returns (findings, blockers)."""
    server = review_all(content, meta, image, profile)
    client = {f.get("key"): f for f in (client_findings or []) if isinstance(f, dict) and f.get("key")}
    out, seen, blockers = [], set(), []
    for sf in server:
        seen.add(sf["key"])
        cf = client.get(sf["key"], {})
        status = cf.get("status") if cf.get("status") in ("accepted", "rejected") else "open"
        note = (cf.get("note") or "").strip() or None
        f = light({**sf, "status": status, "note": note})
        if f["strictness"] == "mandatory" and status == "rejected" and not note:
            blockers.append({"key": f["key"], "label": f["label"], "quote": f["quote"], "reason": "An override needs a written reason"})
        elif _is_blocking(f):
            blockers.append({"key": f["key"], "label": f["label"], "quote": f["quote"], "reason": "Fix it, or reject it with a reason"})
        out.append(f)
    for k, cf in client.items():  # decisions already taken (fixed issues) and browser-only image findings
        if k in seen:
            continue
        if cf.get("status") == "accepted" or str(cf.get("ruleId", "")) in KEEP_IMG_RULES:
            out.append(light({**cf, "status": cf.get("status") if cf.get("status") in ("accepted", "rejected") else "open"}))
    return out, blockers


def _validate_meta(d):
    title = (d.get("title") or "").strip()
    if not title:
        raise ApiError(422, "Add a title")
    if d.get("type") not in ("blog", "social", "ad", "email", "document"):
        raise ApiError(422, "Unknown content type")
    return title


def _clean_image(img):
    if not img:
        return None
    return {k: str(img.get(k) or "")[:2000] for k in ("name", "alt", "fonts", "textInImage")}


def _meta(d):
    return {"type": d["type"], "audience": d.get("audience", ""), "purpose": d.get("purpose", "")}


def _comment(sub, user, text):
    sub["comments"].append({"id": f"{sub['id']}-c{len(sub['comments'])}", "by": user["name"], "role": user["role"], "text": text, "at": now()})


def _check_content(cfg, content):
    if not (content or "").strip():
        raise ApiError(422, "Add some content")
    if len(content) > cfg.max_content_chars:
        raise ApiError(413, "Content is too long")


def create_submission(store, cfg, user, d):
    if user["role"] == "reviewer":
        raise ApiError(403, "Reviewers approve content; they do not submit it.")
    title = _validate_meta(d)
    content = d.get("content", "")
    _check_content(cfg, content)
    profile = store.get_profile()
    image = _clean_image(d.get("image"))
    findings, blockers = verified_findings(content, _meta(d), image, profile, d.get("findings"))
    if blockers:
        raise ApiError(422, "Mandatory brand rules still need a decision", blockers=blockers)
    at = now()
    sid = store.next_submission_id()
    sub = {"id": sid, "title": title, "type": d["type"], "audience": d.get("audience", ""), "purpose": d.get("purpose", ""),
           "author": user["name"], "status": "in_review", "createdAt": at, "updatedAt": at, "profileVersion": profile["version"],
           "versions": [{"n": 1, "content": content, "at": at, "by": user["name"], "note": "First submission"}],
           "image": image, "findings": findings, "comments": [], "activity": [{"at": at, "by": user["name"], "text": "Submitted for review"}]}
    note = (d.get("note") or "").strip()
    if note:
        _comment(sub, user, note)
    store.put_submission(sub)
    return sub


def _get(store, sid):
    s = store.get_submission(sid)
    if not s:
        raise ApiError(404, "Submission not found")
    return s


def resubmit(store, cfg, user, sid, d):
    sub = _get(store, sid)
    if user["role"] == "reviewer":
        raise ApiError(403, "Reviewers cannot resubmit content.")
    if sub["author"] != user["name"] and user["role"] != "manager":
        raise ApiError(403, "Only the author or a brand manager can revise this.")
    if sub["status"] not in ("changes_requested", "rejected"):
        raise ApiError(409, f"A submission that is {sub['status'].replace('_', ' ')} cannot be revised.")
    content = d.get("content", "")
    _check_content(cfg, content)
    profile = store.get_profile()
    fields = {k: d[k] for k in ("title", "type", "audience", "purpose") if d.get(k)}
    if "type" in fields and fields["type"] not in ("blog", "social", "ad", "email", "document"):
        raise ApiError(422, "Unknown content type")
    merged = {**sub, **fields}
    image = _clean_image(d["image"]) if "image" in d else sub.get("image")
    findings, blockers = verified_findings(content, _meta(merged), image, profile, d.get("findings"))
    if blockers:
        raise ApiError(422, "Mandatory brand rules still need a decision", blockers=blockers)
    n = len(sub["versions"]) + 1
    at = now()
    sub.update(fields)
    sub.update({"image": image, "status": "in_review", "updatedAt": at, "profileVersion": profile["version"], "findings": findings})
    sub["versions"].append({"n": n, "content": content, "at": at, "by": user["name"], "note": (d.get("note") or "").strip() or "Revised"})
    sub["activity"].append({"at": at, "by": user["name"], "text": f"Resubmitted as version {n}"})
    note = (d.get("note") or "").strip()
    if note:
        _comment(sub, user, note)
    store.put_submission(sub)
    return sub


def decide(store, user, sid, d):
    if user["role"] not in ("reviewer", "manager"):
        raise ApiError(403, "Only reviewers and brand managers can decide.")
    status = d.get("status")
    if status not in DECISIONS:
        raise ApiError(422, "Status must be approved, changes_requested or rejected")
    sub = _get(store, sid)
    if sub["status"] != "in_review":
        raise ApiError(409, f"This submission is already {sub['status'].replace('_', ' ')}.")
    if sub["author"] == user["name"]:
        raise ApiError(403, "You cannot decide your own submission. Ask another reviewer.")
    comment = (d.get("comment") or "").strip()
    if status in ("changes_requested", "rejected") and not comment:
        raise ApiError(422, "Say what needs to change: a comment is required.")
    if status == "approved":
        attention = [f for f in sub["findings"] if f["strictness"] == "mandatory" and (f["status"] == "rejected" or (f["status"] == "open"))]
        if attention and not d.get("acknowledged"):
            raise ApiError(409, "This submission has unresolved or overridden mandatory findings. Acknowledge them to approve.",
                           needsAcknowledgement=True, count=len(attention))
    at = now()
    sub["status"] = status
    sub["updatedAt"] = at
    if comment:
        _comment(sub, user, comment)
    text = LABEL[status] + (" (mandatory findings acknowledged)" if status == "approved" and d.get("acknowledged") else "")
    sub["activity"].append({"at": at, "by": user["name"], "text": text})
    store.put_submission(sub)
    return sub


def add_comment(store, user, sid, d):
    text = (d.get("text") or "").strip()
    if not text:
        raise ApiError(422, "Write a comment")
    if len(text) > 4000:
        raise ApiError(413, "Comment is too long")
    sub = _get(store, sid)
    _comment(sub, user, text)
    store.put_submission(sub)
    return sub


def recheck(store, user, sid, text=None):
    if user["role"] not in ("reviewer", "manager"):
        raise ApiError(403, "Only reviewers and brand managers can re-check submissions.")
    sub = _get(store, sid)
    profile = store.get_profile()
    latest = sub["versions"][-1]
    server = review_all(latest["content"], _meta(sub), sub.get("image"), profile)
    prior = {f["key"]: f for f in sub["findings"]}
    out = []
    for f in server:
        p = prior.get(f["key"])
        out.append(light({**f, "status": p["status"] if p and p["status"] != "open" else "open", "note": p and p.get("note")}))
    out += [f for k, f in prior.items() if k not in {x["key"] for x in out} and f["ruleId"] in KEEP_IMG_RULES]
    added = len([f for f in out if f["key"] not in prior])
    sub["findings"] = out
    sub["profileVersion"] = profile["version"]
    sub["activity"].append({"at": now(), "by": user["name"], "text": text or f"Re-checked against brand profile v{profile['version']}: {added} new finding{'' if added == 1 else 's'}"})
    store.put_submission(sub)
    return sub
