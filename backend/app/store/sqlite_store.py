import json
import sqlite3

from .base import Store


class SQLiteStore(Store):
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS profiles (version INTEGER PRIMARY KEY, data TEXT NOT NULL,
                    created_by TEXT, summary TEXT, created_at TEXT);
                CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, seq INTEGER, status TEXT,
                    data TEXT NOT NULL, updated_at TEXT);
                """
            )

    def is_empty(self):
        with self.lock:
            return self.db.execute("SELECT COUNT(*) c FROM profiles").fetchone()["c"] == 0

    def get_profile(self):
        with self.lock:
            r = self.db.execute("SELECT data FROM profiles ORDER BY version DESC LIMIT 1").fetchone()
        return json.loads(r["data"])

    def get_changelog(self):
        with self.lock:
            rows = self.db.execute("SELECT version, created_at, created_by, summary FROM profiles ORDER BY version").fetchall()
        return [{"version": r["version"], "at": r["created_at"], "by": r["created_by"], "summary": r["summary"]} for r in rows]

    def save_profile(self, profile, entry):
        with self.lock, self.db:
            self.db.execute("INSERT INTO profiles(version, data, created_by, summary, created_at) VALUES (?,?,?,?,?)",
                            (profile["version"], json.dumps(profile), entry["by"], entry["summary"], entry["at"]))

    def list_submissions(self):
        with self.lock:
            rows = self.db.execute("SELECT data FROM submissions ORDER BY seq DESC").fetchall()
        return [json.loads(r["data"]) for r in rows]

    def get_submission(self, sid):
        with self.lock:
            r = self.db.execute("SELECT data FROM submissions WHERE id=?", (sid,)).fetchone()
        return json.loads(r["data"]) if r else None

    def put_submission(self, sub):
        seq = int(sub["id"].split("-")[-1])
        with self.lock, self.db:
            self.db.execute("INSERT INTO submissions(id, seq, status, data, updated_at) VALUES (?,?,?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data, updated_at=excluded.updated_at",
                            (sub["id"], seq, sub["status"], json.dumps(sub), sub["updatedAt"]))

    def next_submission_id(self):
        with self.lock:
            r = self.db.execute("SELECT COALESCE(MAX(seq), 1000) m FROM submissions").fetchone()
        return f"S-{r['m'] + 1}"

    def reset(self, profile, changelog, submissions):
        with self.lock, self.db:
            self.db.execute("DELETE FROM profiles")
            self.db.execute("DELETE FROM submissions")
            by_v = {c["version"]: c for c in changelog}
            for v in range(1, profile["version"] + 1):
                c = by_v.get(v, {"by": "System", "summary": "Profile version", "at": None})
                self.db.execute("INSERT INTO profiles(version, data, created_by, summary, created_at) VALUES (?,?,?,?,?)",
                                (v, json.dumps({**profile, "version": v}) if v != profile["version"] else json.dumps(profile),
                                 c["by"], c["summary"], c["at"]))
        for s in submissions:
            self.put_submission(s)
