import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import { SEED_PROFILE, USERS, buildSeedSubmissions, seedChangelog } from "./engine/seed.js";
import { API_CONFIGURED, ApiError, apiFetch, setActor } from "./api.js";

// Two modes. With VITE_API_URL set, the Flask backend is the source of truth: state is loaded from
// GET /api/bootstrap and every action is an API call. If the backend cannot be reached at start-up, the app
// runs on the local reducer + localStorage exactly as before, so the demo never blocks.
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
    remote: false,
    ready: !API_CONFIGURED,
    apiError: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...JSON.parse(raw), remote: false, ready: !API_CONFIGURED, apiError: null };
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
      return { ...fresh(), role: state.role, remote: state.remote, ready: true };
    case "hydrate":
      return { ...state, ...a.data, remote: true, ready: true, apiError: null };
    case "offline":
      return { ...state, remote: false, ready: true };
    case "error":
      return { ...state, apiError: a.message };
    case "replaceSubmission": {
      const exists = state.submissions.some((s) => s.id === a.submission.id);
      return {
        ...state,
        submissions: exists ? state.submissions.map((s) => (s.id === a.submission.id ? a.submission : s)) : [a.submission, ...state.submissions],
        apiError: null,
      };
    }
    case "setProfile":
      return { ...state, profile: a.profile, changelog: a.changelog, apiError: null };
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

// Server calls for the actions that change shared data. Each returns the reducer action(s) to apply.
async function remoteAction(a, state) {
  switch (a.type) {
    case "submit": {
      const s = a.submission;
      const body = { title: s.title, type: s.type, audience: s.audience, purpose: s.purpose, image: s.image, content: s.versions[0].content, findings: s.findings, note: s.comments[0] && s.comments[0].text };
      const { submission } = await apiFetch("POST", "/api/submissions", body);
      return { actions: [{ type: "replaceSubmission", submission }], result: { id: submission.id } };
    }
    case "resubmit": {
      const body = { ...a.fields, content: a.content, findings: a.findings, note: a.note };
      const { submission } = await apiFetch("POST", `/api/submissions/${a.id}/versions`, body);
      return { actions: [{ type: "replaceSubmission", submission }], result: { id: submission.id } };
    }
    case "decide": {
      const { submission } = await apiFetch("POST", `/api/submissions/${a.id}/decision`, { status: a.status, comment: a.comment, acknowledged: !!a.acknowledged });
      return { actions: [{ type: "replaceSubmission", submission }], result: { id: submission.id } };
    }
    case "comment": {
      const { submission } = await apiFetch("POST", `/api/submissions/${a.id}/comments`, { text: a.text });
      return { actions: [{ type: "replaceSubmission", submission }], result: { id: submission.id } };
    }
    case "recheck": {
      const { submission } = await apiFetch("POST", `/api/submissions/${a.id}/recheck`, { text: a.text });
      return { actions: [{ type: "replaceSubmission", submission }], result: { id: submission.id } };
    }
    case "profile": {
      const { profile, changelog } = await apiFetch("PUT", "/api/profile", { profile: a.profile, summary: a.summary });
      return { actions: [{ type: "setProfile", profile, changelog }], result: { version: profile.version } };
    }
    case "reset": {
      await apiFetch("POST", "/api/reset");
      const data = await apiFetch("GET", "/api/bootstrap");
      return { actions: [{ type: "hydrate", data: { profile: data.profile, changelog: data.changelog, submissions: data.submissions } }], result: {} };
    }
    default:
      return null;
  }
}

export function StoreProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, load);
  const ref = useRef(state);
  ref.current = state;

  // Tell the API layer who is acting (sent as headers on every request).
  useEffect(() => { setActor({ role: state.role, name: USERS[state.role].name }); }, [state.role]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    let alive = true;
    apiFetch("GET", "/api/bootstrap")
      .then((d) => alive && rawDispatch({ type: "hydrate", data: { profile: d.profile, changelog: d.changelog, submissions: d.submissions } }))
      .catch(() => alive && rawDispatch({ type: "offline" }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (state.remote) return; // the server holds the data; only the local fallback is cached in the browser
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, apiError: null }));
    } catch {
      /* ignore */
    }
  }, [state]);

  // Async dispatch. Resolves to a result object ({id}, {version}) or null if the server rejected the action
  // (the reason is in state.apiError). In local mode it behaves like before.
  async function dispatch(a) {
    const s = ref.current;
    if (!s.remote || !["submit", "resubmit", "decide", "comment", "recheck", "profile", "reset"].includes(a.type)) {
      const result = a.type === "submit" ? { id: `S-${s.nextId}` } : {};
      rawDispatch(a);
      return result;
    }
    try {
      const out = await remoteAction(a, s);
      out.actions.forEach((x) => rawDispatch(x));
      return out.result;
    } catch (e) {
      if (e instanceof ApiError) {
        const detail = e.data && e.data.blockers ? ` (${e.data.blockers.map((b) => b.label).join(", ")})` : "";
        rawDispatch({ type: "error", message: e.message + detail });
        return null;
      }
      rawDispatch({ type: "error", message: "Could not reach the server. Check your connection and try again." });
      return null;
    }
  }

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
