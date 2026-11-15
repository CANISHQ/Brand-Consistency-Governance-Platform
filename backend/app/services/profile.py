import jsonschema

from ..auth import ApiError
from .workflow import now

SRC = {"type": "object", "required": ["doc", "ref"], "properties": {"doc": {"type": "string"}, "ref": {"type": "string"}}}
PROFILE_SCHEMA = {
    "type": "object",
    "required": ["brandName", "productName", "voice", "approvedClaims", "palette", "fonts", "approvedAssets", "deprecatedAssets", "imageRules", "rules"],
    "properties": {
        "brandName": {"type": "string", "minLength": 1, "maxLength": 100},
        "productName": {"type": "object", "required": ["current", "former"], "properties": {"current": {"type": "string", "minLength": 1}, "former": {"type": "array", "items": {"type": "string"}}}},
        "voice": {"type": "array", "items": {"type": "string"}},
        "approvedClaims": {"type": "array", "items": {"type": "string"}},
        "palette": {"type": "array", "items": {"type": "object", "required": ["name", "hex"], "properties": {"name": {"type": "string"}, "hex": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}}}},
        "fonts": {"type": "array", "items": {"type": "string"}},
        "approvedAssets": {"type": "array", "items": {"type": "string"}},
        "deprecatedAssets": {"type": "array", "items": {"type": "string"}},
        "imageRules": {"type": "object"},
        "rules": {"type": "array", "maxItems": 200, "items": {"type": "object", "required": ["id", "kind", "strictness", "label", "category"], "properties": {
            "id": {"type": "string"}, "kind": {"enum": ["term", "claim", "stat", "tone", "exclaim", "caps", "long", "link", "structure"]},
            "strictness": {"enum": ["mandatory", "flexible"]}, "source": SRC}}},
    },
}


def validate_profile(p):
    try:
        jsonschema.validate(p, PROFILE_SCHEMA)
    except jsonschema.ValidationError as e:
        raise ApiError(422, f"Brand profile is invalid: {e.message}", path=list(e.absolute_path))
    for r in p["rules"]:
        for pat in r.get("patterns", []):
            import re
            try:
                re.compile(pat["src"])
            except (re.error, KeyError):
                raise ApiError(422, f"Rule {r['id']} has an invalid pattern")


def summarise(old, new):
    parts = []
    if new["productName"]["current"] != old["productName"]["current"]:
        parts.append(f"Product renamed to {new['productName']['current']}")
    if new["deprecatedAssets"] != old["deprecatedAssets"]:
        parts.append("Retired assets updated")
    if new["approvedClaims"] != old["approvedClaims"]:
        parts.append("Approved claims updated")
    if new["rules"] != old["rules"]:
        parts.append("Rules updated")
    if new["palette"] != old["palette"] or new["fonts"] != old["fonts"]:
        parts.append("Visual identity updated")
    return "; ".join(parts) or "Brand profile updated"


def save_profile(store, user, d):
    prof = d.get("profile")
    if not isinstance(prof, dict):
        raise ApiError(422, "Send the brand profile as `profile`")
    validate_profile(prof)
    with store.lock:
        cur = store.get_profile()
        version = cur["version"] + 1
        new = {**prof, "version": version}
        summary = (d.get("summary") or "").strip() or summarise(cur, new)
        store.save_profile(new, {"version": version, "at": now(), "by": user["name"], "summary": summary})
    return new
