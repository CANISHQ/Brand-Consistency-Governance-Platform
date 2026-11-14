import React, { createContext, useContext, useEffect, useReducer } from "react";
import { SEED_PROFILE, buildSeedSubmissions, seedChangelog } from "./engine/seed.js";

const KEY = "codeblooded.brandgov.v2";
const Ctx = createContext(null);

function fresh() {
  return {
    profile: SEED_PROFILE,
    changelog: seedChangelog(),
    submissions: buildSeedSubmissions(SEED_PROFILE),
    role: "creator",
    editId: null,
    nextId: 1007,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable: fall through to fresh state */
  }
  return fresh();
}

const now = () => new Date().toISOString();

function reducer(state, a) {
  switch (a.type) {
    case "role":
      return { ...state, role: a.role };
    case "edit":
      return { ...state, editId: a.id };
    case "reset":
      return fresh();
    case "profile": {
      const version = state.profile.version + 1;
      return {
        ...state,
        profile: { ...a.profile, version },
        changelog: [...state.changelog, { version, at: now(), by: a.by, summary: a.summary }],
      };
    }
    case "submit": {
      const id = `S-${state.nextId}`;
      const s = { ...a.submission, id, profileVersion: state.profile.version };
      return { ...state, nextId: state.nextId + 1, submissions: [s, ...state.submissions] };
    }
    case "resubmit": {
      const submissions = state.submissions.map((s) => {
        if (s.id !== a.id) return s;
        const n = s.versions.length + 1;
        return {
          ...s,
          ...a.fields,
          status: "in_review",
          updatedAt: now(),
          profileVersion: state.profile.version,
          versions: [...s.versions, { n, content: a.content, at: now(), by: a.by, note: a.note || "Revised" }],
          findings: a.findings,
          activity: [...s.activity, { at: now(), by: a.by, text: `Resubmitted as version ${n}` }],
        };
      });
      return { ...state, submissions };
    }
    case "decide": {
      const label = { approved: "Approved the content", changes_requested: "Requested changes", rejected: "Rejected the content" }[a.status];
      const submissions = state.submissions.map((s) =>
        s.id !== a.id ? s : {
          ...s,
          status: a.status,
          updatedAt: now(),
          comments: a.comment ? [...s.comments, { id: `${s.id}-c${s.comments.length}`, by: a.by, role: a.role, text: a.comment, at: now() }] : s.comments,
          activity: [...s.activity, { at: now(), by: a.by, text: label }],
        }
      );
      return { ...state, submissions };
    }
    case "comment": {
      const submissions = state.submissions.map((s) =>
        s.id !== a.id ? s : { ...s, comments: [...s.comments, { id: `${s.id}-c${s.comments.length}`, by: a.by, role: a.role, text: a.text, at: now() }] }
      );
      return { ...state, submissions };
    }
    case "recheck": {
      const submissions = state.submissions.map((s) =>
        s.id !== a.id ? s : {
          ...s,
          profileVersion: state.profile.version,
          findings: a.findings,
          activity: [...s.activity, { at: now(), by: a.by, text: a.text }],
        }
      );
      return { ...state, submissions };
    }
    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
