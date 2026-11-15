import React, { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { Field, PageHead, Pill } from "../components/ui.jsx";
import { useStore } from "../store.jsx";
import { RULE_GROUPS, USERS } from "../engine/seed.js";
import { findConflicts } from "../engine/checker.js";
import { timeAgo } from "../util.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function groupMandatory(d, g) {
  const ruleOk = g.rules.length === 0 || g.rules.every((id) => (d.rules.find((r) => r.id === id) || {}).strictness === "mandatory");
  const imgOk = !g.image || g.image.every((k) => d.imageRules[k] === "mandatory");
  return ruleOk && imgOk;
}

function applyDerived(d) {
  const next = clone(d);
  const current = next.productName.current.trim() || next.brandName;
  next.productName.current = current;
  next.brandName = current;
  const t = next.rules.find((r) => r.id === "T-NAME");
  if (t) t.pairs = next.productName.former.map((f) => [f, current]);
  const st = next.rules.find((r) => r.id === "C-STAT");
  if (st) st.approved = next.approvedClaims.filter((c) => /\d/.test(c));
  return next;
}

function summarise(a, b) {
  const out = [];
  if (a.productName.current !== b.productName.current || a.productName.former.join() !== b.productName.former.join()) out.push(`Product name set to ${b.productName.current}`);
  if (a.approvedClaims.join("|") !== b.approvedClaims.join("|")) out.push("Approved claims updated");
  if (a.voice.join() !== b.voice.join()) out.push("Voice updated");
  if (JSON.stringify(a.rules.map((r) => [r.id, r.strictness, r.pairs])) !== JSON.stringify(b.rules.map((r) => [r.id, r.strictness, r.pairs]))) out.push("Rules changed");
  if (JSON.stringify([a.palette, a.fonts, a.approvedAssets, a.deprecatedAssets, a.imageRules]) !== JSON.stringify([b.palette, b.fonts, b.approvedAssets, b.deprecatedAssets, b.imageRules])) out.push("Visual identity updated");
  return out.join("; ") || "Profile updated";
}

export default function Profile() {
  const { state, dispatch } = useStore();
  const { profile, role, changelog } = state;
  const isManager = role === "manager";
  const [d, setD] = useState(() => clone(profile));
  const [former, setFormer] = useState(profile.productName.former.join(", "));
  const [claims, setClaims] = useState(profile.approvedClaims.join("\n"));
  const [voice, setVoice] = useState(profile.voice.join(", "));
  const [fonts, setFonts] = useState(profile.fonts.join(", "));
  const [assets, setAssets] = useState(profile.approvedAssets.join(", "));
  const [retired, setRetired] = useState(profile.deprecatedAssets.join(", "));
  const [nr, setNr] = useState({ from: "", to: "", strictness: "flexible", doc: "Brand Guidelines", ref: "" });
  const [col, setCol] = useState({ name: "", hex: "#5B4CE0" });
  const [saved, setSaved] = useState("");

  const working = useMemo(() => applyDerived({
    ...d,
    productName: { current: d.productName.current, former: list(former) },
    approvedClaims: lines(claims),
    voice: list(voice),
    fonts: list(fonts),
    approvedAssets: list(assets),
    deprecatedAssets: list(retired),
  }), [d, former, claims, voice, fonts, assets, retired]);

  const dirty = JSON.stringify(working) !== JSON.stringify({ ...clone(profile), version: working.version });
  const conflicts = findConflicts(working);
  const rulesShown = working.rules.filter((r) => r.kind !== "structure");

  function toggleGroup(g, on) {
    const s = on ? "mandatory" : "flexible";
    setD((p) => {
      const n = clone(p);
      n.rules.forEach((r) => { if (g.rules.includes(r.id)) r.strictness = s; });
      (g.image || []).forEach((k) => { n.imageRules[k] = s; });
      return n;
    });
  }

  function setStrict(id, s) {
    setD((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? { ...r, strictness: s } : r)) }));
  }

  function addRule() {
    if (!nr.from.trim() || !nr.to.trim()) return;
    const id = `T-U${Date.now().toString(36)}`;
    setD((p) => ({
      ...p,
      rules: [...p.rules.slice(0, -1), {
        id, kind: "term", strictness: nr.strictness, since: p.version + 1, label: "Preferred term", category: "Terminology",
        pairs: [[nr.from.trim(), nr.to.trim()]], why: `${nr.doc} says to use “${nr.to.trim()}” instead of “${nr.from.trim()}”.`,
        source: { doc: nr.doc.trim() || "Brand Guidelines", ref: nr.ref.trim() || "Added by brand manager" },
      }, p.rules[p.rules.length - 1]],
    }));
    setNr({ ...nr, from: "", to: "", ref: "" });
  }

  function resolve(c, winner) {
    const loser = winner === "a" ? c.b : c.a;
    const drop = winner === "a" ? c.pairsB : c.pairsA;
    setD((p) => ({
      ...p,
      rules: p.rules.map((r) => (r.id === loser.id ? { ...r, pairs: r.pairs.filter(([x, y]) => !drop.some(([dx, dy]) => dx === x && dy === y)) } : r)),
    }));
  }

  async function save() {
    const summary = summarise(profile, working);
    const done = await dispatch({ type: "profile", profile: working, by: USERS.manager.name, summary });
    if (!done) return;
    setD(clone(working));
    setSaved(`Saved as version ${profile.version + 1}. Existing submissions can now be re-checked against it.`);
    setTimeout(() => setSaved(""), 5000);
  }

  function reset() {
    setD(clone(profile));
    setFormer(profile.productName.former.join(", "));
    setClaims(profile.approvedClaims.join("\n"));
    setVoice(profile.voice.join(", "));
    setFonts(profile.fonts.join(", "));
    setAssets(profile.approvedAssets.join(", "));
    setRetired(profile.deprecatedAssets.join(", "));
  }

  const mandatoryLabels = RULE_GROUPS.filter((g) => groupMandatory(working, g)).map((g) => g.label);

  return (
    <div className="page">
      <PageHead eyebrow="Brand setup" title="Answer questions. Get your fact sheet.">
        <Pill tone="info">Version {profile.version}</Pill>
        {isManager ? <Pill tone="ok">You can edit</Pill> : <Pill tone="muted">Read-only</Pill>}
      </PageHead>
      {!isManager && (
        <div className="banner"><Icon name="lock" size={16} /><div><b>Only brand managers edit the profile</b><p>You can read everything here. Switch to “Brand Manager” at the top right to make changes.</p></div></div>
      )}

      <fieldset className="plain" disabled={!isManager}>
        <div className="setup">
          <section className="panel">
            <div className="panel-h"><h2>The platform asks</h2></div>
            <Field label="What is your product called today?"><input className="input" value={d.productName.current} onChange={(e) => setD({ ...d, productName: { ...d.productName, current: e.target.value } })} /></Field>
            <Field label="What was it called before?" hint="Separate with commas. These become mandatory “do not use” terms."><input className="input" value={former} onChange={(e) => setFormer(e.target.value)} /></Field>
            <Field label="Which claims are approved?" hint="One per line. Anything stronger needs an approved source."><textarea className="input" rows={3} value={claims} onChange={(e) => setClaims(e.target.value)} /></Field>
            <Field label="Describe your voice in three words" hint="Comma separated"><input className="input" value={voice} onChange={(e) => setVoice(e.target.value)} /></Field>
            <div className="field">
              <span className="field-l">Which rules are mandatory?</span>
              <div className="checks">
                {RULE_GROUPS.map((g) => (
                  <label key={g.id} className="check"><input type="checkbox" checked={groupMandatory(working, g)} onChange={(e) => toggleGroup(g, e.target.checked)} /> {g.label}</label>
                ))}
              </div>
              <span className="field-h">Mandatory rules block submission until fixed or overridden with a reason. The rest are flexible guidance.</span>
            </div>
          </section>

          <section className="panel fact">
            <div className="fact-head"><b>BRAND FACT SHEET</b><span className="auto-badge">AUTO-GENERATED</span></div>
            <div className="fact-body">
              <div><span className="fact-l">Names &amp; terms</span><p>{working.productName.current}{working.productName.former.length > 0 && <> (not {working.productName.former.map((f) => `“${f}”`).join(", ")})</>}</p></div>
              <div><span className="fact-l">Approved claims</span>{working.approvedClaims.length ? working.approvedClaims.map((c) => <p key={c}>“{c}”</p>) : <p className="muted">None yet</p>}</div>
              <div><span className="fact-l">Voice &amp; tone</span><p>{working.voice.join(" · ") || "Not set"}</p></div>
              <div><span className="fact-l">Mandatory rules</span><p>{mandatoryLabels.join(", ") || "None"}</p></div>
              <div><span className="fact-l">Visual identity</span><div className="swatches">{working.palette.map((p) => <span key={p.hex + p.name} className="sw" style={{ background: p.hex }} title={`${p.name} ${p.hex}`} />)}</div><p className="small muted">{working.fonts.join(", ") || "No fonts set"} · Logo: {working.approvedAssets[0] || "not set"}</p></div>
            </div>
            <p className="fact-foot">A brand manager reviews it before it goes live.</p>
          </section>
        </div>

        <section className="panel">
          <div className="panel-h"><h2>Rules and sources</h2><span className="muted small">Every finding cites one of these</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Rule</th><th>What it checks</th><th>Source</th><th>Strictness</th></tr></thead>
              <tbody>
                {rulesShown.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.label}</b><div className="muted small">{r.category}</div></td>
                    <td className="small">{r.pairs ? r.pairs.map(([a, b]) => `${a} → ${b}`).join(", ") : r.why}</td>
                    <td className="small">{r.source ? `${r.source.doc} · ${r.source.ref}` : "Approved Examples"}</td>
                    <td>
                      <select className="input sm-in" value={r.strictness} onChange={(e) => setStrict(r.id, e.target.value)} aria-label={`Strictness for ${r.label}`}>
                        <option value="mandatory">Mandatory</option>
                        <option value="flexible">Flexible</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="add-rule">
            <b className="small">Add a terminology rule</b>
            <div className="grid-4">
              <input className="input" placeholder="Avoid" value={nr.from} onChange={(e) => setNr({ ...nr, from: e.target.value })} aria-label="Term to avoid" />
              <input className="input" placeholder="Use instead" value={nr.to} onChange={(e) => setNr({ ...nr, to: e.target.value })} aria-label="Preferred term" />
              <input className="input" placeholder="Source document" value={nr.doc} onChange={(e) => setNr({ ...nr, doc: e.target.value })} aria-label="Source document" />
              <input className="input" placeholder="Section" value={nr.ref} onChange={(e) => setNr({ ...nr, ref: e.target.value })} aria-label="Source section" />
            </div>
            <div className="row-gap">
              <select className="input sm-in" value={nr.strictness} onChange={(e) => setNr({ ...nr, strictness: e.target.value })} aria-label="New rule strictness"><option value="flexible">Flexible</option><option value="mandatory">Mandatory</option></select>
              <button className="btn sm" disabled={!nr.from.trim() || !nr.to.trim()} onClick={addRule}><Icon name="plus" size={14} /> Add rule</button>
            </div>
          </div>
        </section>

        {conflicts.length > 0 && (
          <section className="panel conflict-panel">
            <div className="panel-h"><h2><Icon name="alert" size={18} /> Guideline conflict alert</h2><span className="muted small">The platform will not guess between these</span></div>
            {conflicts.map((c, i) => (
              <div key={i} className="conflict">
                <div className="conflict-pair">
                  <div className="cbox"><b>{c.a.source.doc}</b><span className="muted small">{c.a.source.ref}</span>{c.pairsA.map(([x, y]) => <p key={x}>“{x}” → “{y}”</p>)}</div>
                  <span className="neq">≠</span>
                  <div className="cbox"><b>{c.b.source.doc}</b><span className="muted small">{c.b.source.ref}</span>{c.pairsB.map(([x, y]) => <p key={x}>“{x}” → “{y}”</p>)}</div>
                </div>
                <div className="row-gap wrap">
                  <span className="muted small">Both rules touch “{c.term}”. Which source wins?</span>
                  <button className="btn sm" onClick={() => resolve(c, "a")}>{c.a.source.doc}</button>
                  <button className="btn sm" onClick={() => resolve(c, "b")}>{c.b.source.doc}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="panel">
          <div className="panel-h"><h2>Visual identity</h2></div>
          <div className="grid-2">
            <div className="field">
              <span className="field-l">Colour palette</span>
              <div className="palette-list">
                {working.palette.map((p) => (
                  <span key={p.hex + p.name} className="pal"><span className="sw" style={{ background: p.hex }} /> {p.name} <span className="mono small muted">{p.hex}</span>
                    <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => setD((x) => ({ ...x, palette: x.palette.filter((q) => q.hex !== p.hex || q.name !== p.name) }))}><Icon name="x" size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="row-gap">
                <input className="input" placeholder="Colour name" value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} aria-label="Colour name" />
                <input type="color" className="color-in" value={col.hex} onChange={(e) => setCol({ ...col, hex: e.target.value })} aria-label="Colour value" />
                <button className="btn sm" disabled={!col.name.trim()} onClick={() => { setD((x) => ({ ...x, palette: [...x.palette, { name: col.name.trim(), hex: col.hex.toUpperCase() }] })); setCol({ name: "", hex: col.hex }); }}>Add</button>
              </div>
            </div>
            <div>
              <Field label="Approved fonts" hint="Comma separated"><input className="input" value={fonts} onChange={(e) => setFonts(e.target.value)} /></Field>
              <Field label="Approved logo assets" hint="File names"><input className="input" value={assets} onChange={(e) => setAssets(e.target.value)} /></Field>
              <Field label="Retired logo or asset names" hint="Images whose file name contains one of these are flagged"><input className="input" value={retired} onChange={(e) => setRetired(e.target.value)} /></Field>
            </div>
          </div>
        </section>
      </fieldset>

      <div className="submit-bar">
        <div className="sb-info">{saved ? <span className="ok-txt"><Icon name="check" size={16} /> {saved}</span> : dirty ? <span className="warn-txt">Unsaved changes. Saving creates version {profile.version + 1}.</span> : <span className="muted">No unsaved changes.</span>}</div>
        <button className="btn" disabled={!dirty || !isManager} onClick={reset}>Discard</button>
        <button className="btn btn-primary lg" disabled={!dirty || !isManager} onClick={save}><Icon name="check" size={18} /> Save as version {profile.version + 1}</button>
      </div>

      <section className="panel">
        <div className="panel-h"><h2>Profile history</h2></div>
        <ol className="timeline">
          {[...changelog].reverse().map((c) => (
            <li key={c.version}><span className="tl-dot" /><div><b>Version {c.version}</b> <span className="muted small">· {c.by} · {timeAgo(c.at)}</span><p>{c.summary}</p></div></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
