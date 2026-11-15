import React, { useState } from "react";
import Icon from "./Icon.jsx";
import { ROLES } from "../engine/seed.js";

export default function OnboardingModal({ initialUser, onSave, onClose, isEdit = false }) {
  const [name, setName] = useState(initialUser?.name || "");
  const [designation, setDesignation] = useState(initialUser?.designation || "");
  const [role, setRole] = useState(initialUser?.role || "creator");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!designation.trim()) {
      setError("Please enter your designation or title.");
      return;
    }
    setError("");
    onSave({
      name: name.trim(),
      designation: designation.trim(),
      role,
      onboarded: true,
    });
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="User Onboarding and Identity">
      <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow-s">Identity & Access Setup</div>
            <h2 className="serif" style={{ margin: "4px 0" }}>
              {isEdit ? "Update Your Profile" : "Welcome to CodeBlooded"}
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              {isEdit
                ? "Switch roles or update your designation to test different governance perspectives."
                : "Enter your real name and role. Prototype identity: this is not secure sign-in, so use it for demonstration only."}
            </p>
          </div>
          {isEdit && onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div style={{ background: "rgba(255, 107, 94, 0.15)", border: "1px solid #FF6B5E", borderRadius: 8, padding: "8px 12px", color: "#FF6B5E", fontSize: 13.5 }}>
              <Icon name="alert" size={14} /> {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Your Full Name</label>
            <input
              type="text"
              className="inp"
              placeholder="e.g. Alex Morgan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Designation / Title</label>
            <input
              type="text"
              className="inp"
              placeholder="e.g. Lead Content Strategist / Brand Director"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Select Your Role</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {ROLES.map((r) => {
                const isSelected = role === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    style={{
                      border: isSelected ? "2px solid var(--accent)" : "1px solid var(--line)",
                      background: isSelected ? "rgba(91, 76, 224, 0.08)" : "var(--panel2)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: isSelected ? "var(--accent)" : "var(--fg)" }}>
                        {r.label}
                      </span>
                      {isSelected && <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>Active</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.4 }}>
                      {r.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: "var(--panel2)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--line)", fontSize: 12, color: "var(--muted)" }}>
            <Icon name="shield" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            <b>Role-Based Permission Matrix:</b>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6, fontSize: 11.5 }}>
              <div><b>Creator:</b> Review content, suggest edits.</div>
              <div><b>Reviewer:</b> Review, Approvals, Insights.</div>
              <div><b>Owner:</b> Full edit & publish.</div>
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
              <Icon name="check" size={16} /> {isEdit ? "Update Profile" : "Save Identity & Enter Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
