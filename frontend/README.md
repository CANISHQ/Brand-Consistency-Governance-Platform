# Frontend

React app for the Brand Consistency and Governance Platform.

## Run

```
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Deploy on Vercel with the root directory set to `frontend`, build command `npm run build` and output directory `dist`.

## Screens

| Route | Purpose |
|---|---|
| `#/` | Landing page |
| `#/review` | Review studio: paste content or an image, run the check, accept, edit or reject each finding, rewrite in brand voice, submit |
| `#/approvals` | Queue, findings, comments, revision history and the reviewer decision |
| `#/profile` | Guided brand setup, auto-generated fact sheet, rules, visual identity, conflicts, profile history |
| `#/insights` | Brand Drift Radar, Change Finder and Impact Scanner |
| `#/responsible` | What runs where, and how AI is used |

Use the role switcher (top right) to act as Creator, Reviewer or Brand Manager.

## Connecting the Flask backend

Set `VITE_API_URL` at build time. The app then calls:

- `POST /api/review` with `{ content, meta, image, profile }` and expects `{ findings: Finding[] }`
- `POST /api/rewrite` with `{ content, meta, profile, dismissed }` and expects `{ text, applied, skipped }`

The finding shape is documented at the top of `src/engine/checker.js`. If the API is unset or unreachable, the app uses the built-in rules engine so the workflow keeps working.

## Data

Submissions, comments and profile changes are stored in the browser (`localStorage`) until the Supabase layer is connected. Replace the reducer in `src/store.jsx` with API calls when the database is ready.
