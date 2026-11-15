// API layer. If VITE_API_URL is set the app calls the Flask backend; if the call fails
// (or no URL is set) it falls back to the built-in rule engine so the workflow always runs.
import { reviewAll, rewriteContent } from "./engine/checker.js";
import { lightFinding } from "./util.js";

const BASE = ((typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) || "").replace(/\/$/, "");

export const API_CONFIGURED = !!BASE;

// Who is acting. The backend enforces permissions from these headers (demo auth) or from a Supabase token.
let actor = { role: "creator", name: "" };
export function setActor(a) { actor = a; }

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

// Any request. Throws ApiError on HTTP errors (with the server's message) and a plain Error when unreachable.
export async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-User-Role": actor.role, "X-User-Name": actor.name },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status}`, data);
  return data;
}

const post = (path, body) => apiFetch("POST", path, body);

// POST /api/review  { content, meta, image, profile } -> { findings: Finding[] }
export async function review(payload) {
  if (BASE) {
    try {
      const data = await post("/api/review", payload);
      return { findings: data.findings, engine: "api" };
    } catch (e) {
      console.warn("Review API unavailable, using local rules:", e.message);
    }
  }
  return { findings: reviewAll(payload), engine: "local" };
}

// POST /api/rewrite  { content, meta, profile, dismissed } -> { text, applied, skipped }
export async function rewrite(payload) {
  if (BASE) {
    try {
      return { ...(await post("/api/rewrite", payload)), engine: "api" };
    } catch (e) {
      console.warn("Rewrite API unavailable, using local rules:", e.message);
    }
  }
  return { ...rewriteContent(payload.content, payload.meta, payload.profile, new Set(payload.dismissed || [])), engine: "local" };
}

// Re-run the checks on a submission's latest version, keeping earlier decisions on findings that still apply.
export async function recheck(submission, profile) {
  const latest = submission.versions[submission.versions.length - 1];
  const res = await review({
    content: latest.content,
    meta: { type: submission.type, audience: submission.audience, purpose: submission.purpose },
    image: submission.image,
    profile,
  });
  const prior = new Map(submission.findings.map((f) => [f.key, f]));
  const findings = res.findings.map((f) => {
    const p = prior.get(f.key);
    return lightFinding({ ...f, status: p && p.status !== "open" ? p.status : "open", note: p && p.note });
  });
  return { findings, added: findings.filter((f) => !prior.has(f.key)).length };
}
