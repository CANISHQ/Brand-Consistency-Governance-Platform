"""Sample (non-confidential) data: the brand profile v2 and six submissions, with timestamps re-based to 'now'."""
import copy
import json
import pathlib
import re
from datetime import datetime, timedelta, timezone

PATH = pathlib.Path(__file__).parent / "data" / "seed_data.json"
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _shift(v, delta):
    if isinstance(v, str) and ISO.match(v):
        return (_parse(v) + delta).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(v, list):
        return [_shift(x, delta) for x in v]
    if isinstance(v, dict):
        return {k: _shift(x, delta) for k, x in v.items()}
    return v


def load_seed(now=None):
    raw = json.loads(PATH.read_text())
    now = now or datetime.now(timezone.utc)
    delta = now - _parse(raw["generatedAt"])
    data = _shift(copy.deepcopy(raw), delta)
    for s in data["submissions"]:
        s.setdefault("comments", [])
        s.setdefault("activity", [])
    return data["profile"], data["changelog"], data["submissions"]
