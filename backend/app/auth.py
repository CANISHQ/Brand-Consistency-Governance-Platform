from functools import wraps

import jwt
from werkzeug.exceptions import HTTPException
from flask import current_app, g, jsonify, request

ROLES = ("creator", "reviewer", "manager")
DEMO_USERS = {"manager": "Anika Rao", "creator": "Priya Shah", "reviewer": "Rohan Mehta"}


class ApiError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def current_user():
    cfg = current_app.config["CFG"]
    if cfg.auth_mode == "jwt":
        h = request.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            raise ApiError(401, "Sign in required")
        try:
            claims = jwt.decode(h[7:], cfg.jwt_secret, algorithms=["HS256"], audience="authenticated")
        except jwt.PyJWTError:
            raise ApiError(401, "Invalid or expired token")
        role = (claims.get("app_metadata") or {}).get("brand_role", "creator")
        meta = claims.get("user_metadata") or {}
        name = meta.get("full_name") or meta.get("name") or claims.get("email") or "User"
        if role not in ROLES:
            role = "creator"
        return {"id": claims.get("sub"), "role": role, "name": name}
    # demo mode: trusts headers. For a hackathon demo only, never for production.
    role = request.headers.get("X-User-Role", "creator").lower()
    if role not in ROLES:
        raise ApiError(400, f"Unknown role “{role}”")
    return {"id": None, "role": role, "name": request.headers.get("X-User-Name") or DEMO_USERS[role]}


def require(*roles):
    def deco(fn):
        @wraps(fn)
        def inner(*a, **kw):
            g.user = current_user()
            if roles and g.user["role"] not in roles:
                raise ApiError(403, f"The {g.user['role']} role cannot do this. Allowed: {', '.join(roles)}.")
            return fn(*a, **kw)
        return inner
    return deco


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def _api(e):
        return jsonify({"error": e.message, **e.extra}), e.status

    @app.errorhandler(404)
    def _404(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def _405(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(413)
    def _413(e):
        return jsonify({"error": "Request too large"}), 413

    @app.errorhandler(Exception)
    def _500(e):
        if isinstance(e, HTTPException):
            return jsonify({"error": e.description}), e.code
        current_app.logger.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on the server"}), 500
