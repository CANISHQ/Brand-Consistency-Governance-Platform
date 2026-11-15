"""Supabase (PostgREST) store. Uses the service key, which stays on the server.

NOTE: written against the PostgREST contract and covered by tests with a fake HTTP layer. It has not been run
against a live Supabase project yet. Apply schema/supabase.sql first.
"""
import requests

from .base import Store


class SupabaseStore(Store):
    def __init__(self, url, key, session=None, timeout=10):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.s = session or requests.Session()
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.timeout = timeout

    def _req(self, method, table, params=None, json=None, prefer=None):
        h = dict(self.h)
        if prefer:
            h["Prefer"] = prefer
        r = self.s.request(method, f"{self.base}/{table}", params=params, json=json, headers=h, timeout=self.timeout)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase {method} {table} failed: {r.status_code} {r.text[:200]}")
        return r.json() if r.text else None

    def is_empty(self):
        return not self._req("GET", "bg_profiles", {"select": "version", "limit": "1"})

    def get_profile(self):
        rows = self._req("GET", "bg_profiles", {"select": "data", "order": "version.desc", "limit": "1"})
        return rows[0]["data"]

    def get_changelog(self):
        rows = self._req("GET", "bg_profiles", {"select": "version,created_at,created_by,summary", "order": "version.asc"})
        return [{"version": r["version"], "at": r["created_at"], "by": r["created_by"], "summary": r["summary"]} for r in rows]

    def save_profile(self, profile, entry):
        self._req("POST", "bg_profiles", json={"version": profile["version"], "data": profile, "created_by": entry["by"],
                                               "summary": entry["summary"], "created_at": entry["at"]})

    def list_submissions(self):
        rows = self._req("GET", "bg_submissions", {"select": "data", "order": "seq.desc"})
        return [r["data"] for r in rows]

    def get_submission(self, sid):
        rows = self._req("GET", "bg_submissions", {"select": "data", "id": f"eq.{sid}", "limit": "1"})
        return rows[0]["data"] if rows else None

    def put_submission(self, sub):
        self._req("POST", "bg_submissions", params={"on_conflict": "id"}, prefer="resolution=merge-duplicates",
                  json={"id": sub["id"], "seq": int(sub["id"].split("-")[-1]), "status": sub["status"],
                        "data": sub, "updated_at": sub["updatedAt"]})

    def next_submission_id(self):
        rows = self._req("GET", "bg_submissions", {"select": "seq", "order": "seq.desc", "limit": "1"})
        return f"S-{(rows[0]['seq'] if rows else 1000) + 1}"

    def reset(self, profile, changelog, submissions):
        self._req("DELETE", "bg_submissions", {"id": "neq."})
        self._req("DELETE", "bg_profiles", {"version": "gte.0"})
        by_v = {c["version"]: c for c in changelog}
        for v in range(1, profile["version"] + 1):
            c = by_v.get(v, {"by": "System", "summary": "Profile version", "at": None})
            self.save_profile(profile if v == profile["version"] else {**profile, "version": v}, c)
        for s in submissions:
            self.put_submission(s)
