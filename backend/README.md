# Backend (Flask)

API for the Brand Consistency and Governance Platform. Rule-based checks are always on; Gemini is an optional layer on top.

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # edit ALLOWED_ORIGINS, optional GEMINI_API_KEY
python wsgi.py                # http://localhost:5000  (first run creates and seeds brandgov.db)
pytest -q                     # 40 tests
```

Frontend: `cd frontend && VITE_API_URL=http://localhost:5000 npm run dev`. The header pill shows **API connected** when the server is in use and **Local rules engine** when the browser fell back.

## Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/health` | anyone | status, store, auth mode, AI on/off |
| GET | `/api/bootstrap` | any role | profile, changelog, all submissions, current user |
| POST | `/api/review` | any role | `{content, meta, image}` → `{findings}` (rules, plus AI if enabled) |
| POST | `/api/rewrite` | any role | `{content, meta, dismissed}` → `{text, applied, skipped}` |
| GET / PUT | `/api/profile` | read: any, write: **manager** | brand profile, versioned, validated |
| GET / POST | `/api/submissions` | read: any, create: creator, manager | create runs the checks again on the server |
| GET | `/api/submissions/<id>` | any | one submission |
| POST | `/api/submissions/<id>/versions` | author or manager | resubmit after changes |
| POST | `/api/submissions/<id>/decision` | **reviewer, manager** | `{status, comment, acknowledged}` |
| POST | `/api/submissions/<id>/comments` | any | add comment |
| POST | `/api/submissions/<id>/recheck` | reviewer, manager | re-run against the latest profile, keep earlier decisions |
| POST | `/api/reset` | manager | restore sample data (`ALLOW_RESET=1`) |

## Rules the server enforces (the browser cannot skip them)

- Findings are re-run on the server against the **stored** profile on every submit; a request cannot supply its own rules.
- A mandatory finding must be fixed, or rejected with a written reason, before submit. Conflicts and uncertain items are routed to the reviewer.
- Reviewers do not submit; nobody decides their own submission; "changes requested" and "rejected" need a comment.
- Approving with open or overridden mandatory findings needs `acknowledged: true`.
- Only a manager changes the brand profile; every save is a new version with a changelog entry.

## Gemini (optional)

Set `GEMINI_API_KEY`. The key stays on the server. Only the draft, audience, voice and approved claims are sent. The model can only add **flexible** findings; every quote must appear in the draft, and a source that is not in the profile is downgraded to "needs a person". Rewrites are polished only if they add no numbers and no new mandatory violations. Any failure falls back to the rule engine.

## Auth

`AUTH_MODE=demo` trusts `X-User-Role` / `X-User-Name` headers (the UI role switcher). That is for the demo only: anyone can claim to be a manager.
`AUTH_MODE=jwt` requires a Supabase access token and reads the role from `app_metadata.brand_role`. The frontend has no sign-in screen yet.

## Storage

`STORE=sqlite` (default) or `STORE=supabase` with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` after running `schema/supabase.sql`.

## Not yet verified live

- Gemini and Supabase code paths are tested with mocked HTTP only, not against the real services.
- Render's free tier loses the SQLite file on redeploy; use Supabase for anything you want to keep.

## Layout

`app/engine/checker.py` rules engine (exact port of the frontend engine, verified against exported JS output) · `app/services/` workflow and profile · `app/ai/gemini.py` · `app/store/` · `app/routes.py` · `tests/`.

## Deploy

Backend (Render): root `backend`, build `pip install -r requirements.txt`, start `gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 4`, set `ALLOWED_ORIGINS` to the frontend URL. Keep one worker with SQLite.
Frontend (Vercel): root `frontend`, build `node build.mjs`, output `dist`, env `VITE_API_URL=https://<your-backend>`.
