import time
from collections import defaultdict, deque

from flask import Blueprint, current_app, g, jsonify, request

from .ai.gemini import Gemini
from .auth import ApiError, current_user, require
from .engine.checker import review_all, rewrite_content
from .seed import load_seed
from .services import profile as profile_svc
from .services import workflow

bp = Blueprint("api", __name__, url_prefix="/api")
_hits = defaultdict(deque)
TYPES = ("blog", "social", "ad", "email", "document")


def store():
    return current_app.config["STORE"]


def cfg():
    return current_app.config["CFG"]


def ai() -> Gemini:
    return current_app.config["AI"]


def body():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ApiError(400, "Send a JSON object")
    return d


def throttle(limit=60, window=60):
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    q, t = _hits[ip], time.monotonic()
    while q and t - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise ApiError(429, "Too many requests. Try again in a minute.")
    q.append(t)


def clean_meta(d):
    m = d.get("meta") or {}
    if not isinstance(m, dict) or m.get("type") not in TYPES:
        raise ApiError(422, "meta.type must be one of " + ", ".join(TYPES))
    return {"type": m["type"], "audience": str(m.get("audience") or "")[:300], "purpose": str(m.get("purpose") or "")[:300]}


def clean_content(d):
    c = d.get("content")
    if not isinstance(c, str):
        raise ApiError(422, "content must be a string")
    if len(c) > cfg().max_content_chars:
        raise ApiError(413, "Content is too long")
    return c


def clean_image(d):
    img = d.get("image")
    if not img:
        return None
    if not isinstance(img, dict):
        raise ApiError(422, "image must be an object")
    out = {k: str(img.get(k) or "")[:2000] for k in ("name", "alt", "fonts", "textInImage")}
    a = img.get("analysis")
    if isinstance(a, dict):
        off = [c for c in (a.get("offPalette") or [])[:6] if isinstance(c, dict) and isinstance(c.get("nearest"), dict)
               and isinstance(c.get("hex"), str) and isinstance(c.get("share"), (int, float))]
        lowc = a.get("lowContrast") if isinstance(a.get("lowContrast"), dict) and isinstance(a["lowContrast"].get("ratio"), (int, float)) else None
        out["analysis"] = {"offPalette": off, "lowContrast": lowc}
    return out


@bp.get("/health")
def health():
    return jsonify({"ok": True, "store": cfg().store, "auth": cfg().auth_mode, "ai": ai().enabled})


@bp.get("/bootstrap")
@require()
def bootstrap():
    s = store()
    return jsonify({"profile": s.get_profile(), "changelog": s.get_changelog(), "submissions": s.list_submissions(),
                    "user": g.user, "ai": {"enabled": ai().enabled, "model": cfg().gemini_model if ai().enabled else None},
                    "config": {"auth": cfg().auth_mode, "store": cfg().store}})


@bp.post("/review")
@require()
def review():
    throttle()
    d = body()
    content, meta, image = clean_content(d), clean_meta(d), clean_image(d)
    profile = store().get_profile()  # the server's own profile is the source of truth, never the one in the request
    findings = review_all(content, meta, image, profile)
    ai_used = False
    extra = ai().suggest(content, meta, profile, findings) if ai().enabled else []
    if extra:
        ai_used = True
        findings = sorted(findings + extra, key=lambda f: (0 if f["strictness"] == "mandatory" else 1, f.get("start", 10 ** 9)))
    return jsonify({"findings": findings, "engine": "rules+ai" if ai_used else "rules", "profileVersion": profile["version"]})


@bp.post("/rewrite")
@require()
def rewrite():
    throttle()
    d = body()
    content, meta = clean_content(d), clean_meta(d)
    dismissed = {k for k in (d.get("dismissed") or []) if isinstance(k, str)}
    profile = store().get_profile()
    res = rewrite_content(content, meta, profile, dismissed)
    res["polished"] = False
    if ai().enabled:
        better = ai().polish(res["text"], meta, profile)
        if better and better != res["text"]:
            res["text"], res["polished"] = better, True
    return jsonify(res)


# ----- profile -----
@bp.get("/profile")
@require()
def get_profile():
    return jsonify({"profile": store().get_profile(), "changelog": store().get_changelog()})


@bp.put("/profile")
@require("manager")
def put_profile():
    new = profile_svc.save_profile(store(), g.user, body())
    return jsonify({"profile": new, "changelog": store().get_changelog()})


# ----- submissions -----
@bp.get("/submissions")
@require()
def list_submissions():
    subs = store().list_submissions()
    st = request.args.get("status")
    if st:
        subs = [s for s in subs if s["status"] == st]
    return jsonify({"submissions": subs})


@bp.get("/submissions/<sid>")
@require()
def get_submission(sid):
    s = store().get_submission(sid)
    if not s:
        raise ApiError(404, "Submission not found")
    return jsonify({"submission": s})


@bp.post("/submissions")
@require()
def create_submission():
    with store().lock:
        sub = workflow.create_submission(store(), cfg(), g.user, body())
    return jsonify({"submission": sub}), 201


@bp.post("/submissions/<sid>/versions")
@require()
def new_version(sid):
    with store().lock:
        return jsonify({"submission": workflow.resubmit(store(), cfg(), g.user, sid, body())})


@bp.post("/submissions/<sid>/decision")
@require()
def decision(sid):
    with store().lock:
        return jsonify({"submission": workflow.decide(store(), g.user, sid, body())})


@bp.post("/submissions/<sid>/comments")
@require()
def comment(sid):
    with store().lock:
        return jsonify({"submission": workflow.add_comment(store(), g.user, sid, body())}), 201


@bp.post("/submissions/<sid>/recheck")
@require()
def recheck(sid):
    with store().lock:
        return jsonify({"submission": workflow.recheck(store(), g.user, sid, (request.get_json(silent=True) or {}).get("text"))})


@bp.post("/reset")
@require("manager")
def reset():
    if not cfg().allow_reset:
        raise ApiError(403, "Reset is disabled")
    store().reset(*load_seed())
    return jsonify({"ok": True})
