"""Analytics computed only from stored submissions. Nothing is sample data."""
from collections import Counter, defaultdict


def compute(subs, brand_id=None, product_id=None):
    if brand_id:
        subs = [s for s in subs if s.get("brandId") == brand_id]
    if product_id:
        subs = [s for s in subs if s.get("productId") == product_id]
    by_status = Counter(s["status"] for s in subs)
    decided = [s for s in subs if s["status"] in ("approved", "rejected", "changes_requested") or len(s["versions"]) > 1]
    first_time = [s for s in subs if s["status"] == "approved" and len(s["versions"]) == 1]
    ever_changes = [s for s in subs if len(s["versions"]) > 1 or s["status"] in ("changes_requested", "rejected")]
    rec = defaultdict(lambda: {"count": 0, "submissions": set(), "category": "", "severity": "suggestion"})
    cats, brands = Counter(), {}
    rank = {"critical": 3, "warning": 2, "suggestion": 1}
    for s in subs:
        b = brands.setdefault((s.get("brandId"), s.get("productId")), {"brandId": s.get("brandId"), "brandName": s.get("brandName"), "productId": s.get("productId"),
                                                                       "productName": s.get("productName"), "submissions": 0, "approved": 0, "changesOrRejected": 0, "issues": 0})
        b["submissions"] += 1
        b["approved"] += s["status"] == "approved"
        b["changesOrRejected"] += s["status"] in ("changes_requested", "rejected")
        for f in s["findings"]:
            n = f.get("occurrences") or 1
            r = rec[f["label"]]
            r["count"] += n
            r["submissions"].add(s["id"])
            r["category"] = f.get("category")
            if rank.get(f.get("severity"), 0) > rank.get(r["severity"], 0):
                r["severity"] = f["severity"]
            cats[f.get("category")] += n
            b["issues"] += n
    recurring = sorted(({"label": k, "category": v["category"], "severity": v["severity"], "count": v["count"], "submissions": len(v["submissions"])}
                        for k, v in rec.items()), key=lambda x: (-x["count"], x["label"]))[:12]
    return {"totals": {"submissions": len(subs), "inReview": by_status["in_review"], "approved": by_status["approved"], "changesRequested": by_status["changes_requested"],
                       "rejected": by_status["rejected"], "approvedFirstTime": len(first_time), "neededRevisions": len(ever_changes),
                       "firstTimeRate": round(len(first_time) / len(subs), 2) if subs else None},
            "recurring": recurring, "byCategory": [{"category": k, "count": v} for k, v in cats.most_common()],
            "byBrand": sorted(brands.values(), key=lambda x: -x["submissions"])}
