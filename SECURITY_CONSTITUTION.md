# Security Constitution — Personal Gemini Journal

These are the custom instructions configured in Google AI Studio before any
application code was written, and the design rules the codebase follows.

## 1. Threat model (per feature, before building it)

**Authentication**
- Threat: forged/replayed tokens, client claiming a different uid than it owns.
- Mitigation: every backend route calls `admin.auth().verifyIdToken()` server-side
  (`lib/verifyAuth.js`). The uid used everywhere downstream comes from the verified
  token, never from a client-supplied field.

**Multi-turn chat**
- Threat: prompt injection via journal content trying to exfiltrate the system
  prompt or make the model ignore instructions; unbounded input causing cost/DoS.
- Mitigation: message length capped server-side (8,000 chars/turn, 40,000 chars for
  end-of-session transcripts). The Gemini call never executes anything the model
  returns — its output is only ever displayed as text or parsed as a fixed JSON
  schema (RDI scoring), never eval'd.

**Data storage (Firestore)**
- Threat: one user reading or writing another user's journal entries; a compromised
  or modified client bypassing UI-level checks.
- Mitigation: enforced in `firestore.rules`, server-side, not just hidden in the UI:
  `allow read, write: if request.auth != null && request.auth.uid == userId;` on
  `/users/{userId}/sessions/{sessionId}`, with a default-deny on everything else.
  The backend itself never touches Firestore — it has no Firestore client at all —
  so there is no path where a backend bug could leak across users.

**Secret management**
- Threat: API key committed to git, shipped in the client bundle, or visible in logs.
- Mitigation: the Gemini API key lives only in Google Cloud Secret Manager and is
  fetched at runtime by the Cloud Run service (`lib/secrets.js`). It is never
  logged, never returned in any API response, and never present in `public/`
  (the only client-side Firebase config is the public web app config, which is
  not a secret by design — Firebase's own docs confirm this).

## 2. Secure coding standards

- All input validated server-side (type + length) before touching the model.
- No `eval`, no `new Function`, no dynamic `require` of user-influenced strings.
- CORS enabled but the API is meaningless without a valid Firebase ID token —
  there is no unauthenticated data path.
- Errors returned to the client are generic ("Failed to get a response"); full
  error detail is only logged server-side (Cloud Run logs), never sent to the client.
- Dependencies pinned to caret ranges of actively maintained official SDKs only
  (`firebase-admin`, `@google-cloud/secret-manager`, `@google/generative-ai`).

## 3. Database isolation rules

- Every document lives under `/users/{uid}/sessions/{sessionId}` — the uid is
  baked into the path, not a field that could be spoofed.
- Firestore rules check `request.auth.uid == userId` on every read and write.
- Default-deny catch-all rule (`match /{document=**} { allow read, write: if false; }`)
  ensures any collection added later is unreadable until explicitly opened up.
- No shared/global collections exist in this app at all.

## 4. Secret management specifics

- Production: `GEMINI_API_KEY_SECRET_NAME` env var points Cloud Run at the Secret
  Manager resource; the Cloud Run service account is granted
  `roles/secretmanager.secretAccessor` on that one secret only (least privilege).
- Local dev only: `GEMINI_API_KEY` may be set in a gitignored `.env` file — this
  path is clearly commented in code as dev-only and is never used in the deployed
  container.
- `.gitignore` excludes `.env`, `*.env.local`, and any credentials/service-account
  JSON files.
