import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import FindingCard from "../components/FindingCard.jsx";
import { Pill, Field, PageHead, Empty } from "../components/ui.jsx";
import { useStore } from "../store.jsx";
import { review, rewrite, API_CONFIGURED } from "../api.js";
import { CONTENT_TYPES, SAMPLE_DRAFTS, USERS } from "../engine/seed.js";
import { analysePixels } from "../engine/checker.js";
import { CATEGORY_COLOR, diffWords, lightFinding, navigate } from "../util.js";

const blankMeta = { title: "", type: "blog", audience: "", purpose: "" };
const imgSig = (i) => (i ? [i.name, i.alt, i.fonts, i.textInImage] : null);

function Highlighted({ text, findings, selectedId, onSelect }) {
  const spans = findings
    .filter((f) => f.scope === "text" && f.start !== undefined && f.status !== "accepted")
    .sort((a, b) => a.start - b.start);
  const parts = [];
  let pos = 0;
  for (const f of spans) {
    if (f.start < pos) continue;
    if (f.start > pos) parts.push(text.slice(pos, f.start));
    parts.push(
      <mark key={f.id} className={`hl ${f.strictness === "mandatory" ? "hl-m" : "hl-f"} ${f.status === "rejected" ? "hl-x" : ""} ${selectedId === f.id ? "hl-sel" : ""}`} style={{ "--cat": CATEGORY_COLOR[f.category] }}
        onClick={() => onSelect(f.id)} title={`${f.label}: click to see why`}>
        {text.slice(f.start, f.end)}
      </mark>
    );
    pos = f.end;
  }
  parts.push(text.slice(pos));
  return <div className="draft-view" tabIndex={0}>{parts}</div>;
}

function RewriteModal({ original, rw, onAccept, onEdit, onClose }) {
  const diff = useMemo(() => diffWords(original, rw.text), [original, rw.text]);
  const changed = rw.text !== original;
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Brand-aligned rewrite" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow-s">Brand-aligned rewrite</div>
            <h2 className="serif">Compare, then accept, edit or reject</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="cmp">
          <div className="cmp-col">
            <span className="swap-l">Your original</span>
            <div className="cmp-text">{diff.filter((d) => d.t !== "add").map((d, i) => (d.t === "del" ? <del key={i}>{d.v}</del> : <span key={i}>{d.v}</span>))}</div>
          </div>
          <div className="cmp-col cmp-new">
            <span className="swap-l">On-brand version</span>
            <div className="cmp-text">{diff.filter((d) => d.t !== "del").map((d, i) => (d.t === "add" ? <ins key={i}>{d.v}</ins> : <span key={i}>{d.v}</span>))}</div>
          </div>
        </div>
        {changed ? (
          <div className="applied">
            <b>What changed, and why</b>
            <ul>
              {rw.applied.map((a, i) => (
                <li key={i}><span className="mono">{a.quote}</span> → <span className="mono">{a.suggestion}</span> <span className="muted small">· {a.label}</span></li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="hint">The draft already matches the brand rules, so there is nothing to rewrite.</p>
        )}
        {rw.skipped && rw.skipped.length > 0 && (
          <p className="warn-note"><Icon name="alert" size={15} /> {rw.skipped.length} place{rw.skipped.length > 1 ? "s" : ""} left unchanged because approved sources disagree. A person decides those.</p>
        )}
        <p className="muted small">The rewrite keeps your point, audience and call to action, and only uses approved facts. Engine: {rw.engine === "api" ? "Flask API" : "built-in rules"}.</p>
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={!changed} onClick={onAccept}><Icon name="check" size={16} /> Accept rewrite</button>
          <button className="btn" onClick={onEdit}><Icon name="edit" size={16} /> Edit first</button>
          <button className="btn" onClick={onClose}><Icon name="x" size={16} /> Reject</button>
        </div>
      </div>
    </div>
  );
}

export default function Review() {
  const { state, dispatch } = useStore();
  const { profile, role, editId } = state;
  const editing = editId ? state.submissions.find((s) => s.id === editId) : null;
  const last = editing ? editing.versions[editing.versions.length - 1] : null;
  const me = USERS[role];

  const [meta, setMeta] = useState(editing ? { title: editing.title, type: editing.type, audience: editing.audience, purpose: editing.purpose } : blankMeta);
  const [content, setContent] = useState(last ? last.content : "");
  const [image, setImage] = useState(editing && editing.image ? { ...editing.image } : null);
  const [preview, setPreview] = useState(null);
  const [raw, setRaw] = useState(null);
  const [checkedSig, setCheckedSig] = useState(null);
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMap, setStatusMap] = useState({});
  const [resolved, setResolved] = useState([]);
  const [mode, setMode] = useState("edit");
  const [selected, setSelected] = useState(null);
  const [rw, setRw] = useState(null);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const area = useRef(null);
  const fileRef = useRef(null);

  const sig = JSON.stringify([content, imgSig(image), meta.type]);
  const fresh = raw !== null && checkedSig === sig;

  const findings = useMemo(
    () => (raw || []).map((f) => ({ ...f, status: (statusMap[f.key] && statusMap[f.key].status) || "open", note: statusMap[f.key] && statusMap[f.key].note })),
    [raw, statusMap]
  );
  const open = findings.filter((f) => f.status === "open");
  const mandOpen = open.filter((f) => f.strictness === "mandatory");
  const blocking = mandOpen.filter((f) => !f.needsHuman);
  const routed = open.filter((f) => f.needsHuman);
  const guideOpen = open.filter((f) => f.strictness !== "mandatory");
  const done = [...resolved, ...findings.filter((f) => f.status !== "open")];

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!selected) return;
    const el = document.getElementById(`f-${selected}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  async function runCheck(c = content, img = image, m = meta) {
    setBusy(true);
    try {
      const res = await review({ content: c, meta: m, image: img ? { name: img.name, alt: img.alt, fonts: img.fonts, textInImage: img.textInImage, analysis: img.analysis } : null, profile });
      setRaw(res.findings);
      setEngine(res.engine);
      setCheckedSig(JSON.stringify([c, imgSig(img), m.type]));
      setMode("review");
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (key, status, noteText) => setStatusMap((m) => ({ ...m, [key]: { status, note: noteText } }));

  const act = {
    accept: async (f, text) => {
      const next = content.slice(0, f.start) + text + content.slice(f.end);
      setContent(next);
      setResolved((r) => [...r, { ...f, status: "accepted", applied: text }]);
      await runCheck(next);
    },
    choose: async (f, option) => {
      if (option.text) return act.accept(f, option.text);
      setStatus(f.key, "rejected", `Kept as written, following ${option.source.doc}`);
      return undefined;
    },
    reject: (f, reason) => setStatus(f.key, "rejected", reason),
    undo: (f) => setStatusMap((m) => { const n = { ...m }; delete n[f.key]; return n; }),
    done: (f) => setStatus(f.key, "accepted", "Marked as fixed by the creator"),
    fixDoc: async (f) => {
      const next = f.fix.type === "append" ? content.replace(/\s+$/, "") + f.fix.text : f.fix.text + content;
      setContent(next);
      setResolved((r) => [...r, { ...f, status: "accepted", applied: f.fix.text.trim() }]);
      await runCheck(next);
    },
    setAlt: async (alt) => {
      const img = { ...image, alt };
      setImage(img);
      await runCheck(content, img);
    },
    editInDraft: (f) => {
      setMode("edit");
      setTimeout(() => {
        if (area.current && f.start !== undefined) {
          area.current.focus();
          area.current.setSelectionRange(f.start, f.end);
        }
      }, 30);
    },
  };

  function onContent(v) {
    setContent(v);
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      setPreview(url);
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const analysis = analysePixels(ctx.getImageData(0, 0, c.width, c.height).data, profile.palette);
      setImage((i) => ({ alt: "", fonts: "", textInImage: "", ...(i || {}), name: file.name, analysis, width: bmp.width, height: bmp.height }));
    } catch {
      setImage((i) => ({ alt: "", fonts: "", textInImage: "", ...(i || {}), name: file.name }));
    }
  }

  function loadSample() {
    const s = SAMPLE_DRAFTS[meta.type];
    setMeta((m) => ({ ...m, title: s.title, audience: s.audience, purpose: s.purpose }));
    setContent(s.content);
    setRaw(null); setStatusMap({}); setResolved([]); setMode("edit");
  }

  function loadSampleImage() {
    setPreview(null);
    setImage({ name: "holiday-post-Logo-Primary-2023.png", alt: "", fonts: "Comic Sans, Inter", textInImage: "HOLIDAY OFFER! Alpha is the best platform on the market" });
  }

  async function doRewrite() {
    const dismissed = Object.keys(statusMap).filter((k) => statusMap[k].status === "rejected");
    const res = await rewrite({ content, meta, profile, dismissed });
    setRw(res);
  }

  async function acceptRewrite() {
    const text = rw.text;
    setResolved((r) => [...r, ...rw.applied.filter((a) => a.key).map((a) => ({ ...a, status: "accepted", applied: a.suggestion }))]);
    setContent(text);
    setRw(null);
    await runCheck(text);
    setToast("Rewrite applied. Review the highlights, then submit for approval.");
  }

  function editRewrite() {
    setContent(rw.text);
    setRw(null);
    setRaw(null);
    setMode("edit");
  }

  const canSubmitRole = role !== "reviewer";
  const ready = fresh && blocking.length === 0 && meta.title.trim() && content.trim();
  const why = !canSubmitRole ? "Reviewers approve content; switch to Creator or Brand Manager to submit."
    : !meta.title.trim() ? "Add a title."
    : !content.trim() ? "Add some content."
    : !fresh ? "Run the brand check on the current draft first."
    : blocking.length ? `${blocking.length} mandatory ${blocking.length > 1 ? "issues need" : "issue needs"} a decision (accept, edit or reject with a reason).`
    : "";

  async function submit() {
    const outFindings = [...resolved.map((f) => ({ ...f, status: "accepted" })), ...findings].map(lightFinding);
    const at = new Date().toISOString();
    const imgLight = image ? { name: image.name, alt: image.alt, fonts: image.fonts, textInImage: image.textInImage } : null;
    if (editing) {
      const done = await dispatch({ type: "resubmit", id: editing.id, fields: { title: meta.title, type: meta.type, audience: meta.audience, purpose: meta.purpose, image: imgLight }, content, findings: outFindings, by: me.name, note: note.trim() || "Revised after review" });
      if (!done) return;
      if (note.trim() && !state.remote) dispatch({ type: "comment", id: editing.id, by: me.name, role, text: note.trim() });
      dispatch({ type: "edit", id: null });
      navigate(`/approvals?id=${editing.id}`);
    } else {
      const id = `S-${state.nextId}`;
      const done = await dispatch({
        type: "submit",
        submission: {
          title: meta.title.trim(), type: meta.type, audience: meta.audience, purpose: meta.purpose, author: me.name, status: "in_review",
          createdAt: at, updatedAt: at, versions: [{ n: 1, content, at, by: me.name, note: "First submission" }], image: imgLight, findings: outFindings,
          comments: note.trim() ? [{ id: `${id}-c0`, by: me.name, role, text: note.trim(), at }] : [],
          activity: [{ at, by: me.name, text: "Submitted for review" }],
        },
      });
      if (!done) return;
      navigate(`/approvals?id=${done.id || id}`);
    }
  }

  function cancelRevision() {
    dispatch({ type: "edit", id: null });
    navigate("/approvals");
  }

  const groups = [
    { id: "m", title: "Mandatory rules", hint: "Must be fixed or overridden with a reason", items: mandOpen.filter((f) => !f.needsHuman) },
    { id: "h", title: "Needs a person", hint: "Uncertain or conflicting: routed to a reviewer if left open", items: routed },
    { id: "g", title: "Flexible guidance", hint: "Suggestions that keep the brand feel", items: guideOpen },
  ];

  return (
    <div className="page">
      <PageHead eyebrow={editing ? `Revising ${editing.id} · version ${editing.versions.length + 1}` : "Review studio"} title={editing ? "Revise and resubmit" : "Check content before it goes live"}>
        <Pill tone={API_CONFIGURED ? "ok" : "muted"}>{API_CONFIGURED ? "Flask API" : "Built-in rules engine"}</Pill>
        <Pill tone="info">Brand profile v{profile.version}</Pill>
      </PageHead>

      {editing && (
        <div className="banner">
          <Icon name="chat" size={16} />
          <div>
            <b>Reviewer feedback</b>
            {editing.comments.slice(-2).map((c) => <p key={c.id}>{c.by}: “{c.text}”</p>)}
          </div>
          <button className="btn sm" onClick={cancelRevision}>Cancel revision</button>
        </div>
      )}

      <div className="studio">
        <section className="panel studio-in">
          <div className="panel-h"><h2>1 · Your content</h2>
            <button className="btn sm" onClick={loadSample}><Icon name="sparkle" size={14} /> Load sample {meta.type}</button>
          </div>

          <div className="grid-2">
            <Field label="Title"><input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="e.g. Spring launch blog" /></Field>
            <Field label="Content type">
              <select className="input" value={meta.type} onChange={(e) => { setMeta({ ...meta, type: e.target.value }); }}>
                {CONTENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Audience"><input className="input" value={meta.audience} onChange={(e) => setMeta({ ...meta, audience: e.target.value })} placeholder="Who is this for?" /></Field>
            <Field label="Purpose"><input className="input" value={meta.purpose} onChange={(e) => setMeta({ ...meta, purpose: e.target.value })} placeholder="What should it achieve?" /></Field>
          </div>

          <div className="editor-h">
            <div className="seg" role="tablist" aria-label="Draft view">
              <button role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "seg-b on" : "seg-b"} onClick={() => setMode("edit")}><Icon name="edit" size={14} /> Edit</button>
              <button role="tab" aria-selected={mode === "review"} className={mode === "review" ? "seg-b on" : "seg-b"} disabled={!fresh} onClick={() => setMode("review")}><Icon name="eye" size={14} /> Highlights</button>
            </div>
            <span className="muted small">{content.trim() ? content.trim().split(/\s+/).length : 0} words · {content.length} characters</span>
          </div>

          {mode === "edit" || !fresh ? (
            <textarea ref={area} className="input editor" value={content} onChange={(e) => onContent(e.target.value)} placeholder="Paste a post, advertisement, email or document. You can also load a sample." aria-label="Content to review" />
          ) : (
            <Highlighted text={content} findings={findings} selectedId={selected} onSelect={setSelected} />
          )}
          {raw !== null && !fresh && <p className="warn-note"><Icon name="alert" size={15} /> The draft changed since the last check. Run the check again to refresh the findings.</p>}

          <div className="img-box">
            <div className="img-h">
              <b><Icon name="image" size={16} /> Image or creative <span className="muted small">(optional)</span></b>
              <div className="row-gap">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
                <button className="btn sm" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="upload" size={14} /> Upload image</button>
                {!image && <button className="btn sm" onClick={loadSampleImage}>Use sample creative</button>}
                {image && <button className="btn sm" onClick={() => { setImage(null); setPreview(null); }}><Icon name="trash" size={14} /> Remove</button>}
              </div>
            </div>
            {image && (
              <div className="img-body">
                <div className="img-thumb">{preview ? <img src={preview} alt="Uploaded creative preview" /> : <Icon name="image" size={30} />}</div>
                <div className="img-fields">
                  <p className="mono small">{image.name}{image.width ? ` · ${image.width}×${image.height}` : ""}</p>
                  <Field label="Alt text"><input className="input" value={image.alt} onChange={(e) => setImage({ ...image, alt: e.target.value })} placeholder="Describe the image in one sentence" /></Field>
                  <Field label="Fonts used" hint={`Approved: ${profile.fonts.join(", ")}`}><input className="input" value={image.fonts} onChange={(e) => setImage({ ...image, fonts: e.target.value })} placeholder="e.g. Inter, Comic Sans" /></Field>
                  <Field label="Text visible in the image" hint="Checked like the rest of your copy. With the API connected this can be read automatically."><input className="input" value={image.textInImage} onChange={(e) => setImage({ ...image, textInImage: e.target.value })} /></Field>
                </div>
              </div>
            )}
            {image && image.analysis && <p className="muted small">Colour check ran in your browser on a small copy; the image is not uploaded anywhere.</p>}
          </div>

          <div className="run-row">
            <button className="btn btn-primary lg" disabled={busy || !content.trim()} onClick={() => runCheck()}>
              <Icon name="shield" size={18} /> {busy ? "Checking…" : fresh ? "Re-run brand check" : "Run brand check"}
            </button>
            <button className="btn lg" disabled={!content.trim()} onClick={doRewrite}><Icon name="sparkle" size={18} /> Rewrite in brand voice</button>
          </div>
        </section>

        <section className="panel studio-out" aria-live="polite">
          <div className="panel-h"><h2>2 · Findings</h2>{engine && <Pill tone="muted">{engine === "api" ? "Flask API" : "Built-in rules"}</Pill>}</div>
          {!fresh && (
            <Empty icon="search" title={raw === null ? "No check run yet" : "Draft changed"}>
              {raw === null ? "Load a sample or paste your own content, then run the brand check. Each finding explains the rule, cites its source and suggests a fix." : "Run the check again to refresh."}
            </Empty>
          )}
          {fresh && (
            <>
              <div className="stats">
                <div className="stat stat-m"><b>{blocking.length}</b><span>Mandatory open</span></div>
                <div className="stat stat-h"><b>{routed.length}</b><span>Need a person</span></div>
                <div className="stat stat-g"><b>{guideOpen.length}</b><span>Guidance open</span></div>
                <div className="stat stat-d"><b>{done.length}</b><span>Resolved</span></div>
              </div>
              {findings.length === 0 && resolved.length === 0 && (
                <div className="all-clear"><Icon name="check" size={20} /><div><b>No issues found</b><p>This content matches the brand profile. A reviewer still approves it before publication.</p></div></div>
              )}
              {groups.map((g) => g.items.length > 0 && (
                <div key={g.id} className="fgroup">
                  <div className="fgroup-h"><b>{g.title}</b><span className="muted small">{g.hint}</span></div>
                  {g.items.map((f) => <FindingCard key={f.id} f={f} act={act} selected={selected === f.id} onSelect={() => setSelected(f.id)} />)}
                </div>
              ))}
              {done.length > 0 && (
                <details className="fgroup" open={open.length === 0}>
                  <summary className="fgroup-h"><b>Resolved ({done.length})</b><span className="muted small">Accepted or dismissed</span></summary>
                  {done.map((f, i) => <FindingCard key={`${f.id}-${i}`} f={f} act={act} selected={false} onSelect={() => {}} />)}
                </details>
              )}
            </>
          )}
        </section>
      </div>

      <div className="submit-bar">
        <div className="sb-info">
          {ready ? <span className="ok-txt"><Icon name="check" size={16} /> Ready for approval{routed.length ? ` · ${routed.length} uncertain item${routed.length > 1 ? "s" : ""} will go to the reviewer` : ""}</span> : <span className="muted"><Icon name="lock" size={15} /> {why}</span>}
        </div>
        <input className="input sb-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={editing ? "What did you change? (optional)" : "Note for the reviewer (optional)"} aria-label="Note for the reviewer" />
        <button className="btn btn-primary lg" disabled={!ready || !canSubmitRole} onClick={submit}>
          <Icon name="arrow" size={18} /> {editing ? `Resubmit as version ${editing.versions.length + 1}` : "Submit for approval"}
        </button>
      </div>

      {rw && <RewriteModal original={content} rw={rw} onAccept={acceptRewrite} onEdit={editRewrite} onClose={() => setRw(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
