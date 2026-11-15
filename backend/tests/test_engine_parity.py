"""The Python engine must produce the same findings as the frontend's JS engine (golden.json is exported from it)."""
import json
import pathlib

import pytest

from app.engine.checker import find_conflicts, review_all, rewrite_content

FX = pathlib.Path(__file__).parent / "fixtures" / "golden.json"
SEED = pathlib.Path(__file__).parent.parent / "app" / "data" / "seed_data.json"
GOLD = json.loads(FX.read_text())
PROFILE = json.loads(SEED.read_text())["profile"]
FIELDS = ["id", "key", "ruleId", "label", "category", "strictness", "kind", "scope", "start", "end", "quote",
          "suggestion", "needsHuman", "confidence"]


def pick(f):
    return {k: f.get(k) for k in FIELDS}


@pytest.mark.parametrize("case", GOLD["cases"], ids=[c["name"] for c in GOLD["cases"]])
def test_review_matches_js(case):
    got = review_all(case["content"], case["meta"], case["image"], PROFILE)
    assert [pick(f) for f in got] == [pick(f) for f in case["findings"]]


@pytest.mark.parametrize("case", GOLD["cases"], ids=[c["name"] for c in GOLD["cases"]])
def test_rewrite_matches_js(case):
    got = rewrite_content(case["content"], case["meta"], PROFILE)
    assert got["text"] == case["rewrite"]["text"]
    assert [(a["label"], a["quote"], a["suggestion"]) for a in got["applied"]] == [(a["label"], a["quote"], a["suggestion"]) for a in case["rewrite"]["applied"]]


def test_conflicts_match_js():
    got = [{"a": c["a"]["id"], "b": c["b"]["id"], "term": c["term"]} for c in find_conflicts(PROFILE)]
    assert got == GOLD["conflicts"]
