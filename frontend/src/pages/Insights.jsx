import React, { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { Empty, Field, PageHead, Pill, StatusPill, Tabs } from "../components/ui.jsx";
import { useStore } from "../store.jsx";
import { recheck } from "../api.js";
import { findConflicts } from "../engine/checker.js";
import { CONTENT_TYPES, USERS } from "../engine/seed.js";
import { CATEGORY_COLOR, navigate } from "../util.js";

const typeLabel = (t) => (CONTENT_TYPES.find((c) => c.id === t) || { label: t }).label;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (t) => new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`, "gi");

function snippet(text, term, repl) {
  const m = termRe(term).exec(text);
  if (!m) return null;
  const a = Math.max(0, m.index - 36);
  const b = Math.min(text.length, m.index + m[0].length + 36);
  return { before: (a > 0 ? "…" : "") + text.slice(a, m.index), hit: m[0], after: text.slice(m.index + m[0].length, b) + (b < text.length ? "…" : ""), repl };
}

function Snip({ s }) {
  return (
    <p className="snip">{s.before}<mark className="hl hl-m">{s.hit}</mark>{s.after}
      {s.repl && <span className="snip-r"><Icon name="arrow" size={13} /> <ins>{s.repl}</ins></span>}
    </p>
  );
}

function Bars({ rows, onPick, picked }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <button key={r.id} className={`hbar ${picked === r.id ? "on" : ""}`} onClick={() => onPick && onPick(r.id)} disabled={!onPick}>
          <span className="hbar-l">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--accent)" }} /></span>
          <span className="hbar-v">{r.value}</span>
        </button>
      ))}
    </div>
  );
}

function Radar() {
  const { state } = useStore();
  const { submissions, profile } = state;
  const [picked, setPicked] = useState(null);

  const groups = useMemo(() => {
    const m = new Map();
    submissions.forEach((s) => s.findings.forEach((f) => {
      const g = m.get(f.ruleId) || { id: f.ruleId, label: f.label, category: f.category, subs: new Map(), total: 0, rejected: 0, source: f.source };
      g.total += 1;
      if (f.status === "rejected") g.rejected += 1;
      g.subs.set(s.id, s);
      m.set(f.ruleId, g);
    }));
    return [...m.values()].sort((a, b) => b.subs.size - a.subs.size || b.total - a.total);
  }, [submissions]);

  const top = groups.slice(0, 8);
  const sel = groups.find((g) => g.id === picked) || top[0];
  const byCat = useMemo(() => {
    const c = {};
    submissions.forEach((s) => s.findings.forEach((f) => { c[f.category] = (c[f.category] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ id: k, label: k, value: v, color: CATEGORY_COLOR[k] }));
  }, [submissions]);
  const outcomes = ["in_review", "changes_requested", "approved", "rejected"].map((k) => ({ id: k, label: k.replace("_", " ").replace(/^./, (c) => c.toUpperCase()), value: submissions.filter((s) => s.status === k).length }));
  const unclear = groups.filter((g) => g.total >= 2 && g.rejected / g.total >= 0.4);
  const conflicts = findConflicts(profile);
  const mandatoryOpen = submissions.reduce((n, s) => n + s.findings.filter((f) => f.strictness === "mandatory" && f.status === "open").length, 0);
  const decided = submissions.filter((s) => s.status === "approved" || s.status === "rejected").length;
  const approved = submissions.filter((s) => s.status === "approved").length;

  if (submissions.length === 0) return <Empty icon="chart" title="No submissions yet">Submit content from the review studio and patterns will appear here.</Empty>;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><b>{submissions.length}</b><span>Submissions checked</span></div>
        <div className="kpi"><b>{submissions.reduce((n, s) => n + s.findings.length, 0)}</b><span>Findings raised</span></div>
        <div className="kpi"><b>{mandatoryOpen}</b><span>Mandatory items still open</span></div>
        <div className="kpi"><b>{decided ? `${Math.round((approved / decided) * 100)}%` : "–"}</b><span>Decided items approved</span></div>
      </div>

      <div className="cols-2">
        <section className="panel">
          <div className="panel-h"><h2>Brand Drift Radar</h2><span className="muted small">Recurring issues, fixed once instead of piece by piece</span></div>
          <Bars rows={top.map((g) => ({ id: g.id, label: g.label, value: g.subs.size, color: CATEGORY_COLOR[g.category] }))} onPick={setPicked} picked={sel && sel.id} />
          <p className="muted small">Bar length = number of submissions affected. Click a bar to see where it appears.</p>
          {sel && (
            <div className="fixonce">
              <b><Icon name="target" size={16} /> {sel.label}</b>
              <p>Appeared {sel.total} time{sel.total > 1 ? "s" : ""} across {sel.subs.size} submission{sel.subs.size > 1 ? "s" : ""}. Recheck these items and fix the shared cause once{sel.source ? `, or clarify ${sel.source.doc}` : ""}.</p>
              <div className="chips-row">
                {[...sel.subs.values()].map((s) => (
                  <button key={s.id} className="fchip" onClick={() => navigate(`/approvals?id=${s.id}`)}>{s.title} <span>{typeLabel(s.type)}</span></button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Findings by dimension</h2></div>
            <Bars rows={byCat} />
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Review outcomes</h2></div>
            <Bars rows={outcomes.map((o) => ({ ...o, color: { in_review: "#8E7CFF", changes_requested: "#F5B84B", approved: "#3DD6B0", rejected: "#FF6B5E" }[o.id] }))} />
          </section>
        </div>
      </div>

      <div className="cols-2">
        <section className="panel">
          <div className="panel-h"><h2>Guidelines that may be unclear</h2><span className="muted small">Suggestions creators keep dismissing</span></div>
          {unclear.length === 0 ? <p className="muted">No rule is being dismissed often enough to suggest a gap yet.</p> : unclear.map((g) => (
            <div key={g.id} className="unclear">
              <b>{g.label}</b>
              <span className="muted small">{g.rejected} of {g.total} suggestions dismissed · {g.source ? `${g.source.doc}${g.source.ref ? ` · ${g.source.ref}` : ""}` : ""}</span>
              <p>Consider adding an approved example or a clearer exception to this guideline.</p>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-h"><h2><Icon name="alert" size={18} /> Guideline conflicts</h2></div>
          {conflicts.length === 0 ? <p className="muted">No conflicting guidelines found.</p> : conflicts.map((c, i) => (
            <div key={i} className="unclear">
              <b>{c.a.source.doc} ≠ {c.b.source.doc}</b>
              <span className="muted small">Both rules touch “{c.term}”</span>
              <p>Content that matches both is routed to a person instead of guessed.</p>
              <button className="btn sm" onClick={() => navigate("/profile")}>Resolve in brand profile</button>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function Finder() {
  const { state, dispatch } = useStore();
  const { submissions, profile, role } = state;
  const me = USERS[role];
  const [q, setQ] = useState("Alpha");
  const [to, setTo] = useState("Nova");
  const [flagged, setFlagged] = useState({});

  const term = q.trim();
  const results = useMemo(() => {
    if (!term) return { subs: [], profile: [] };
    const subs = [];
    submissions.forEach((s) => {
      const latest = s.versions[s.versions.length - 1];
      const fields = [["Content", latest.content], ["Title", s.title], ["Image file name", s.image && s.image.name], ["Alt text", s.image && s.image.alt], ["Text in image", s.image && s.image.textInImage]];
      const hits = [];
      fields.forEach(([where, text]) => {
        if (!text) return;
        const sn = snippet(text, term, null);
        if (!sn) return;
        if (to.trim()) sn.repl = `${sn.before}${to.trim()}${sn.after}`;
        hits.push({ where, ...sn });
      });
      if (hits.length) subs.push({ s, hits });
    });
    const pr = [];
    const add = (where, text) => { if (text && termRe(term).test(text)) pr.push({ where, ...snippet(text, term, null) }); };
    profile.approvedClaims.forEach((c) => add("Approved claim", c));
    profile.approvedAssets.forEach((c) => add("Approved asset", c));
    profile.deprecatedAssets.forEach((c) => add("Retired asset", c));
    profile.rules.forEach((r) => { if (r.why) add(`Rule · ${r.label}`, r.why); });
    return { subs, profile: pr };
  }, [term, to, submissions, profile]);

  function flag(s) {
    dispatch({ type: "comment", id: s.id, by: me.name, role, text: `Flagged for recheck: still contains “${term}”${to.trim() ? `. Suggested replacement: “${to.trim()}”` : ""}.` });
    setFlagged((f) => ({ ...f, [s.id]: true }));
  }

  return (
    <section className="panel">
      <div className="panel-h"><h2>Brand Change Finder</h2><span className="muted small">Where does a term, name or asset still appear?</span></div>
      <div className="finder-form">
        <Field label="Find"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Alpha" /></Field>
        <Field label="Replace with (optional)"><input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Nova" /></Field>
      </div>
      <p className="quote-ask">“We’re changing a product name from {term || "…"} to {to.trim() || "…"}. Where does {term || "…"} still appear?”</p>
      {!term ? <p className="muted">Type a term to search every submission and the brand profile.</p> : (
        <>
          <div className="row-gap wrap">
            <Pill tone="info">{results.subs.length} submission{results.subs.length === 1 ? "" : "s"}</Pill>
            <Pill tone="muted">{results.profile.length} profile item{results.profile.length === 1 ? "" : "s"}</Pill>
            <span className="muted small">Matching content and replacements are suggestions. People decide what to change.</span>
          </div>
          {results.subs.map(({ s, hits }) => (
            <div key={s.id} className="hit">
              <div className="hit-h">
                <b>{s.title}</b><StatusPill status={s.status} /><span className="muted small">{typeLabel(s.type)} · {s.id}</span>
                <span className="grow" />
                <button className="btn sm" onClick={() => navigate(`/approvals?id=${s.id}`)}>Open</button>
                <button className="btn sm" disabled={flagged[s.id]} onClick={() => flag(s)}>{flagged[s.id] ? "Flagged" : "Flag for recheck"}</button>
              </div>
              {hits.map((h, i) => <div key={i}><span className="swap-l">{h.where}</span><Snip s={h} /></div>)}
            </div>
          ))}
          {results.profile.length > 0 && (
            <div className="hit">
              <div className="hit-h"><b>Brand profile</b><span className="muted small">Rules and facts that mention “{term}”</span></div>
              {results.profile.map((h, i) => <div key={i}><span className="swap-l">{h.where}</span><Snip s={h} /></div>)}
            </div>
          )}
          {results.subs.length === 0 && results.profile.length === 0 && <Empty icon="check" title={`“${term}” does not appear`}>Nothing in the submissions or brand profile matches.</Empty>}
        </>
      )}
    </section>
  );
}

function Impact() {
  const { state, dispatch } = useStore();
  const { submissions, profile, role } = state;
  const isManager = role === "manager";
  const [kind, setKind] = useState("rename");
  const [from, setFrom] = useState("Nova");
  const [to, setTo] = useState("Nova Pro");
  const [asset, setAsset] = useState("holiday-post");
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const affected = useMemo(() => {
    const out = [];
    submissions.filter((s) => s.status !== "rejected").forEach((s) => {
      const latest = s.versions[s.versions.length - 1];
      if (kind === "rename" && from.trim()) {
        const sn = snippet(latest.content, from.trim(), null);
        if (sn) out.push({ s, sn, why: `Mentions “${from.trim()}”` });
      } else if (kind === "asset" && asset.trim() && s.image && s.image.name.toLowerCase().includes(asset.trim().toLowerCase())) {
        out.push({ s, sn: null, why: `Image file “${s.image.name}” matches “${asset.trim()}”` });
      }
    });
    return out;
  }, [submissions, kind, from, to, asset]);

  async function apply() {
    setBusy(true);
    try {
      const version = profile.version + 1;
      const next = JSON.parse(JSON.stringify(profile));
      next.version = version;
      let summary;
      if (kind === "rename") {
        const last = next.rules[next.rules.length - 1];
        next.rules = [...next.rules.slice(0, -1), {
          id: `T-CHG${version}`, kind: "term", strictness: "mandatory", since: version, label: "Outdated term (brand change)", category: "Terminology",
          pairs: [[from.trim(), to.trim()]], why: `Brand change: “${from.trim()}” is now “${to.trim()}”.`, source: { doc: "Brand change notice", ref: `Version ${version}` },
        }, last];
        summary = `Brand change: “${from.trim()}” → “${to.trim()}” is now a mandatory rule`;
      } else {
        next.deprecatedAssets = [...next.deprecatedAssets, asset.trim()];
        summary = `Asset “${asset.trim()}” retired`;
      }
      dispatch({ type: "profile", profile: next, by: USERS.manager.name, summary });
      for (const { s } of affected) {
        const { findings, added } = await recheck(s, next);
        dispatch({ type: "recheck", id: s.id, findings, by: USERS.manager.name, text: `Impact scan: re-checked against profile v${version} (${added} new finding${added === 1 ? "" : "s"})` });
      }
      setDone(`Profile saved as version ${version} and ${affected.length} submission${affected.length === 1 ? "" : "s"} re-checked.`);
    } finally {
      setBusy(false);
    }
  }

  const ready = kind === "rename" ? from.trim() && to.trim() : asset.trim();

  return (
    <section className="panel">
      <div className="panel-h"><h2>Impact Scanner</h2><span className="muted small">When a rule changes, find the work that needs another check</span></div>
      <div className="finder-form">
        <Field label="What is changing?">
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setScanned(false); setDone(""); }}>
            <option value="rename">Rename a term or product</option>
            <option value="asset">Retire a logo or asset</option>
          </select>
        </Field>
        {kind === "rename" ? (
          <>
            <Field label="Current term"><input className="input" value={from} onChange={(e) => { setFrom(e.target.value); setScanned(false); }} /></Field>
            <Field label="New term"><input className="input" value={to} onChange={(e) => { setTo(e.target.value); setScanned(false); }} /></Field>
          </>
        ) : (
          <Field label="Asset name contains"><input className="input" value={asset} onChange={(e) => { setAsset(e.target.value); setScanned(false); }} /></Field>
        )}
      </div>
      <div className="row-gap wrap">
        <button className="btn btn-primary" disabled={!ready} onClick={() => { setScanned(true); setDone(""); }}><Icon name="search" size={16} /> Scan impact</button>
        {scanned && <span className="muted small">Pending, approved and changes-requested work is included. Rejected work is not.</span>}
      </div>
      {scanned && (
        <>
          <h3 className="h3">{affected.length} item{affected.length === 1 ? "" : "s"} affected</h3>
          {affected.length === 0 && <Empty icon="check" title="Nothing affected">No pending or reviewed content matches this change.</Empty>}
          {affected.map(({ s, sn, why }) => (
            <div key={s.id} className="hit">
              <div className="hit-h"><b>{s.title}</b><StatusPill status={s.status} /><span className="muted small">{why}</span><span className="grow" /><button className="btn sm" onClick={() => navigate(`/approvals?id=${s.id}`)}>Open</button></div>
              {sn && <Snip s={{ ...sn, repl: kind === "rename" && to.trim() ? `${sn.before}${to.trim()}${sn.after}` : null }} />}
            </div>
          ))}
          {affected.length > 0 && (
            <div className="row-gap wrap">
              <button className="btn btn-warn" disabled={!isManager || busy} onClick={apply}><Icon name="refresh" size={16} /> {busy ? "Applying…" : "Apply to brand profile and re-check affected"}</button>
              {!isManager && <span className="muted small"><Icon name="lock" size={14} /> Only brand managers change the profile.</span>}
            </div>
          )}
          {done && <div className="banner banner-ok"><Icon name="check" size={16} /><div><b>{done}</b><p>Open any item to see what the re-check found. People decide which changes to make and approve.</p></div></div>}
        </>
      )}
    </section>
  );
}

export default function Insights() {
  const [tab, setTab] = useState("radar");
  return (
    <div className="page">
      <PageHead eyebrow="Governance insights" title="Governance that looks across content." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "radar", label: "Brand Drift Radar", icon: "target" },
        { id: "finder", label: "Change Finder", icon: "search" },
        { id: "impact", label: "Impact Scanner", icon: "layers" },
      ]} />
      <div className="tab-body flush">
        {tab === "radar" && <Radar />}
        {tab === "finder" && <Finder />}
        {tab === "impact" && <Impact />}
      </div>
    </div>
  );
}
