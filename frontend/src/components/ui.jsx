import React from "react";
import Icon from "./Icon.jsx";
import { STATUS, initials } from "../util.js";

export function Pill({ tone = "muted", children, title }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function StatusPill({ status }) {
  const s = STATUS[status] || { label: status, cls: "" };
  return <span className={`status ${s.cls}`}>{s.label}</span>;
}

export function Avatar({ name, tone }) {
  return <span className={`avatar ${tone ? `av-${tone}` : ""}`} title={name}>{initials(name)}</span>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "tab on" : "tab"} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={15} />} {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value }) {
  const pct = Math.round(value * 100);
  return (
    <span className="meter" title={`${pct}% confidence`}>
      <span className="meter-track"><span className="meter-fill" style={{ width: `${pct}%` }} /></span>
      <span className="meter-num">{pct}%</span>
    </span>
  );
}

export function SourceTag({ source }) {
  if (!source) return null;
  return <span className="src"><Icon name="link" size={13} /> {source.doc}{source.ref ? ` · ${source.ref}` : ""}</span>;
}

export function Empty({ icon = "file", title, children }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-l">{label}</span>
      {children}
      {hint && <span className="field-h">{hint}</span>}
    </label>
  );
}

export function PageHead({ eyebrow, title, children }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow-s">{eyebrow}</div>
        <h1 className="serif page-title">{title}</h1>
      </div>
      {children && <div className="page-head-r">{children}</div>}
    </div>
  );
}
