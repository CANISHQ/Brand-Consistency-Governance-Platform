import React, { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import FindingCard from "../components/FindingCard.jsx";
import { Avatar, Empty, PageHead, Pill, StatusPill, Tabs } from "../components/ui.jsx";
import { useStore } from "../store.jsx";
import { recheck as recheckSubmission } from "../api.js";
import { CONTENT_TYPES, USERS } from "../engine/seed.js";
import { diffWords, getQuery, navigate, timeAgo } from "../util.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "in_review", label: "In review" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];
const typeLabel = (t) => (CONTENT_TYPES.find((c) => c.id === t) || { label: t }).label;
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Detail({ s }) {
  const { state, dispatch } = useStore();
  const { role, profile } = state;
  const me = USERS[role];
  const [tab, setTab] = useState("content");
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vFrom, setVFrom] = useState(Math.max(1, s.versions.length - 1));
  const latest = s.versions[s.versions.length - 1];

  useEffect(() => { setTab("content"); setComment(""); setAck(false); setVFrom(Math.max(1, s.versions.length - 1)); }, [s.id]);

  const unresolved = s.findings.filter((f) => f.status === "open" && f.strictness === "mandatory");
  const overridden = s.findings.filter((f) => f.status === "rejected" && f.strictness === "mandatory");
  const routed = s.findings.filter((f) => f.status === "open" && f.needsHuman);
  const attention = unresolved.length + overridden.length;
  const stale = s.profileVersion < profile.version;
  const isDecider = role === "reviewer" || role === "manager";
  const pending = s.status === "in_review";
  const mine = s.author === me.name || role === "manager";
  const canRevise = (s.status === "changes_requested" || s.status === "rejected") && role !== "reviewer" && mine;

  function decide(status) {
    const text = comment.trim();
    dispatch({ type: "decide", id: s.id, status, comment: text, by: me.name, role });
    setComment("");
    setAck(false);
  }

  async function recheck() {
    setBusy(true);
    try {
      const { findings, added } = await recheckSubmission(s, profile);
      dispatch({ type: "recheck", id: s.id, findings, by: me.name, text: `Re-checked against brand profile v${profile.version}: ${added} new finding${added === 1 ? "" : "s"}` });
    } finally {
      setBusy(false);
    }
  }

  const diff = useMemo(() => {
    const a = s.versions.find((v) => v.n === vFrom);
    return a && s.versions.length > 1 ? diffWords(a.content, latest.content) : null;
  }, [s, vFrom, latest]);

  const counts = { open: s.findings.filter((f) => f.status === "open").length, ok: s.findings.filter((f) => f.status === "accepted").length, no: s.findings.filter((f) => f.status === "rejected").length };

  return (
    <div className="detail panel">
      <div className="d-head">
        <div>
          <div className="row-gap wrap"><StatusPill status={s.status} /><Pill tone="muted">{typeLabel(s.type)}</Pill><span className="mono small muted">{s.id} · v{latest.n}</span></div>
          <h2 className="serif d-title">{s.title}</h2>
          <p className="muted small">By {s.author} · {s.audience || "No audience set"} · {s.purpose || "No purpose set"} · updated {timeAgo(s.updatedAt)}</p>
        </div>
      </div>

      {stale && (
        <div className="banner banner-warn">
          <Icon name="alert" size={16} />
          <div><b>Brand profile changed since this was checked</b><p>Checked against v{s.profileVersion}; the current profile is v{profile.version}. Re-check to see whether anything new applies.</p></div>
          <button className="btn sm" disabled={busy} onClick={recheck}><Icon name="refresh" size={14} /> {busy ? "Checking…" : "Re-check now"}</button>
        </div>
      )}

      <div className="summary-chips">
        <span className="chip chip-m"><b>{unresolved.length}</b> mandatory unresolved</span>
        <span className="chip chip-o"><b>{overridden.length}</b> mandatory overridden</span>
        <span className="chip chip-h"><b>{routed.length}</b> routed to a person</span>
        <span className="chip chip-d"><b>{counts.ok}</b> fixed · <b>{counts.no}</b> dismissed</span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "content", label: "Content", icon: "file" },
        { id: "findings", label: "Findings", icon: "search", count: s.findings.length },
        { id: "comments", label: "Comments", icon: "chat", count: s.comments.length },
        { id: "history", label: "History", icon: "clock", count: s.versions.length },
      ]} />

      {tab === "content" && (
        <div className="tab-body">
          {s.versions.length > 1 && (
            <div className="row-gap wrap diff-bar">
              <span className="muted small">Show changes since</span>
              <select className="input sm-in" value={vFrom} onChange={(e) => setVFrom(Number(e.target.value))} aria-label="Compare from version">
                {s.versions.slice(0, -1).map((v) => <option key={v.n} value={v.n}>Version {v.n}</option>)}
              </select>
              <span className="muted small">→ version {latest.n}</span>
            </div>
          )}
          <div className="doc-view">
            {diff ? diff.map((d, i) => (d.t === "add" ? <ins key={i}>{d.v}</ins> : d.t === "del" ? <del key={i}>{d.v}</del> : <span key={i}>{d.v}</span>)) : latest.content}
          </div>
          {s.image && (
            <div className="img-meta">
              <Icon name="image" size={16} /> <b className="mono small">{s.image.name}</b>
              <span className="muted small">Alt text: {s.image.alt ? `“${s.image.alt}”` : "none"} · Fonts: {s.image.fonts || "not stated"}</span>
            </div>
          )}
        </div>
      )}

      {tab === "findings" && (
        <div className="tab-body">
          {s.findings.length === 0 ? <Empty icon="check" title="No findings">The content matched the brand profile.</Empty> : (
            s.findings.map((f, i) => <FindingCard key={`${f.key}-${i}`} f={{ ...f, id: `${s.id}-${i}`, kind: "advice", scope: "text" }} readOnly selected={false} onSelect={() => {}} />)
          )}
        </div>
      )}

      {tab === "comments" && (
        <div className="tab-body">
          {s.comments.length === 0 && <p className="muted">No comments yet.</p>}
          {s.comments.map((c) => (
            <div key={c.id} className="comment">
              <Avatar name={c.by} tone={c.role} />
              <div><b>{c.by}</b> <span className="muted small">· {c.role} · {timeAgo(c.at)}</span><p>{c.text}</p></div>
            </div>
          ))}
          <div className="comment-form">
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
            <button className="btn sm" disabled={!comment.trim()} onClick={() => { dispatch({ type: "comment", id: s.id, by: me.name, role, text: comment.trim() }); setComment(""); }}>Post comment</button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="tab-body">
          <ol className="timeline">
            {[...s.activity].reverse().map((a, i) => (
              <li key={i}><span className="tl-dot" /><div><b>{a.text}</b><p className="muted small">{a.by} · {fmt(a.at)}</p></div></li>
            ))}
          </ol>
          <h3 className="h3">Versions</h3>
          {s.versions.map((v) => (
            <div key={v.n} className="ver"><b>Version {v.n}</b><span className="muted small">{v.by} · {fmt(v.at)} · {v.note}</span></div>
          ))}
          <p className="muted small">Checked against brand profile v{s.profileVersion}.</p>
        </div>
      )}

      <div className="decision">
        {pending && isDecider && (
          <>
            <div className="decision-h"><Icon name="users" size={16} /> <b>Your decision</b> <span className="muted small">Nothing publishes without authorised approval.</span></div>
            {attention > 0 && (
              <label className="ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I have reviewed the {unresolved.length ? `${unresolved.length} unresolved` : ""}{unresolved.length && overridden.length ? " and " : ""}{overridden.length ? `${overridden.length} overridden` : ""} mandatory item{attention > 1 ? "s" : ""} and accept responsibility for approving.</span>
              </label>
            )}
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required to request changes or reject)" aria-label="Decision comment" />
            <div className="row-gap wrap">
              <button className="btn btn-ok" disabled={attention > 0 && !ack} onClick={() => decide("approved")}><Icon name="check" size={16} /> Approve</button>
              <button className="btn btn-warn" disabled={!comment.trim()} onClick={() => decide("changes_requested")}><Icon name="edit" size={16} /> Request changes</button>
              <button className="btn btn-danger" disabled={!comment.trim()} onClick={() => decide("rejected")}><Icon name="x" size={16} /> Reject</button>
            </div>
          </>
        )}
        {pending && !isDecider && (
          <p className="muted"><Icon name="lock" size={15} /> Waiting for a reviewer. Only reviewers and brand managers can approve, so switch role at the top right to try that step.</p>
        )}
        {!pending && <p className="muted">Decision recorded: <b>{s.status.replace("_", " ")}</b>.{s.status === "approved" ? " It can now be published." : ""}</p>}
        {canRevise && <div className="row-gap"><button className="btn btn-primary" onClick={() => { dispatch({ type: "edit", id: s.id }); navigate("/review"); }}><Icon name="edit" size={16} /> Revise and resubmit</button></div>}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { state } = useStore();
  const { submissions } = state;
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(getQuery().id || null);

  useEffect(() => {
    const on = () => { const id = getQuery().id; if (id) setSel(id); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const list = submissions.filter((s) => (filter === "all" || s.status === filter) && (!q || `${s.title} ${s.author} ${s.id}`.toLowerCase().includes(q.toLowerCase())));
  const cur = submissions.find((s) => s.id === sel) || list[0];
  const count = (id) => (id === "all" ? submissions.length : submissions.filter((s) => s.status === id).length);

  return (
    <div className="page">
      <PageHead eyebrow="Review and approval" title="Approvals">
        <button className="btn btn-primary" onClick={() => navigate("/review")}><Icon name="plus" size={16} /> New check</button>
      </PageHead>
      <div className="approvals">
        <aside className="panel queue">
          <div className="chips-row">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? "fchip on" : "fchip"} onClick={() => setFilter(f.id)}>{f.label} <span>{count(f.id)}</span></button>
            ))}
          </div>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author or ID" aria-label="Search submissions" />
          <div className="q-list">
            {list.length === 0 && <Empty icon="file" title="Nothing here">No submissions match this filter.</Empty>}
            {list.map((s) => {
              const m = s.findings.filter((f) => f.strictness === "mandatory" && f.status !== "accepted").length;
              return (
                <button key={s.id} className={cur && cur.id === s.id ? "q-item on" : "q-item"} onClick={() => { setSel(s.id); navigate(`/approvals?id=${s.id}`); }}>
                  <div className="q-top"><b>{s.title}</b><StatusPill status={s.status} /></div>
                  <div className="q-sub muted small">{typeLabel(s.type)} · {s.author} · {timeAgo(s.updatedAt)}</div>
                  <div className="q-sub small">{m > 0 ? <span className="warn-txt">{m} mandatory item{m > 1 ? "s" : ""} to check</span> : <span className="ok-txt">No mandatory items open</span>}</div>
                </button>
              );
            })}
          </div>
        </aside>
        {cur ? <Detail s={cur} /> : <div className="panel"><Empty icon="file" title="Select a submission" /></div>}
      </div>
    </div>
  );
}
