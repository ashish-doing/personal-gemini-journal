# Personal Gemini Journal — Architecture

## Overview

Personal Gemini Journal splits cleanly into two halves that never touch each other directly: a **client-side auth + data layer** (Firebase Auth + Firestore, straight from the browser) and a **stateless AI proxy** (Cloud Run, holds the Gemini key, never sees Firestore). The split is deliberate — it's the whole isolation story, not an implementation detail.

---

## System Diagram

```mermaid
flowchart TD
    subgraph BROWSER["🖥️ BROWSER — public/index.html"]
        AUTH["Firebase Auth SDK\n━━━━━━━━━━━━━━━\nsign up / sign in\nemail + password"]
        FSCLIENT["Firestore Client SDK\n━━━━━━━━━━━━━━━\ndirect read/write\nsessions/{userId}/*"]
        UI["Journal UI\n━━━━━━━━━━━━━━━\nchat box, send,\nend session, RDI trend"]
        UI --> AUTH
        UI --> FSCLIENT
    end

    subgraph CLOUDRUN["☁️ CLOUD RUN — server.js"]
        MW["verifyAuth.js\n━━━━━━━━━━━━━━━\nfirebase-admin\nverifyIdToken()"]
        CHAT["POST /api/chat\n━━━━━━━━━━━━━━━\nmulti-turn Gemini call"]
        END["POST /api/end-session\n━━━━━━━━━━━━━━━\nstructured RDI JSON"]
        MW --> CHAT
        MW --> END
    end

    subgraph SECRETS["🔐 SECRET MANAGER"]
        SEC["gemini-api-key\n━━━━━━━━━━━━━━━\nfetched at runtime\nnever in client bundle"]
    end

    subgraph FIRESTORE["🔥 CLOUD FIRESTORE"]
        RULES["firestore.rules\n━━━━━━━━━━━━━━━\nrequest.auth.uid == userId\nenforced by Firestore itself"]
        DATA["sessions/{userId}/{sessionId}\n━━━━━━━━━━━━━━━\ntranscript, summary,\nrdi_score, rdi_reasoning"]
        RULES --> DATA
    end

    subgraph GEMINI["🤖 GEMINI API"]
        MODEL["gemini-3.6-flash\n━━━━━━━━━━━━━━━\nsendMessage() — chat\ngenerateContent() — structured JSON"]
    end

    AUTH -->|"ID token"| MW
    FSCLIENT -->|"gated by"| RULES
    CHAT -->|"fetch key"| SEC
    END -->|"fetch key"| SEC
    CHAT -->|"proxy call"| MODEL
    END -->|"proxy call, structured schema"| MODEL

    NOTE["Cloud Run never reads or writes Firestore.\nIsolation is enforced by firestore.rules,\nnot by anything server-side."]
```

---

## Request Flow — Send a Journal Message

```mermaid
sequenceDiagram
    participant User
    participant Browser as index.html
    participant Auth as Firebase Auth
    participant CR as Cloud Run (server.js)
    participant Admin as firebase-admin
    participant SM as Secret Manager
    participant Gemini

    User->>Browser: types message, clicks Send
    Browser->>Auth: getIdToken()
    Auth-->>Browser: fresh ID token
    Browser->>CR: POST /api/chat {history, message}\nAuthorization: Bearer <idToken>
    CR->>Admin: verifyIdToken(idToken)
    Admin-->>CR: decoded uid (or 401 if invalid)
    CR->>SM: access latest version of gemini-api-key
    SM-->>CR: key
    CR->>Gemini: sendMessage(history, message)
    Gemini-->>CR: reply text
    CR-->>Browser: {reply}
    Browser->>Browser: append to chat UI
```

---

## Request Flow — End Session & Score

```mermaid
sequenceDiagram
    participant User
    participant Browser as index.html
    participant CR as Cloud Run (server.js)
    participant Gemini
    participant FS as Firestore (client SDK)

    User->>Browser: clicks "End session & score"
    Browser->>CR: POST /api/end-session {transcript}\nAuthorization: Bearer <idToken>
    CR->>Gemini: generateContent(transcript, structured schema)
    Note over Gemini: Returns {summary, rdi_score, rdi_reasoning}\nas fixed JSON — not free text
    Gemini-->>CR: structured RDI JSON
    CR-->>Browser: {summary, rdi_score, rdi_reasoning}
    Browser->>FS: setDoc(sessions/{uid}/{sessionId}, {...})
    Note over FS: Write only succeeds if\nrequest.auth.uid == userId
    FS-->>Browser: write confirmed
    Browser->>Browser: append point to RDI trend sparkline
```

---

## Component Map

| File | Responsibility |
|---|---|
| `public/index.html` | Single-file frontend — Firebase Auth UI, Firestore read/write, chat UI, RDI trend sparkline |
| `server.js` | Express app — two routes only (`/api/chat`, `/api/end-session`), plus `/healthz` |
| `lib/verifyAuth.js` | Express middleware — verifies the Firebase ID token via `firebase-admin`, attaches `req.uid` |
| `lib/gemini.js` | `sendChatMessage()` (multi-turn) and `scoreSession()` (structured RDI JSON) against Gemini |
| `lib/secrets.js` | Fetches the Gemini key from Secret Manager at runtime using `GEMINI_API_KEY_SECRET_NAME` |
| `firestore.rules` | The actual isolation enforcement — `request.auth.uid == userId` on every read/write |
| `firebase.json` | Points the Firebase CLI at `firestore.rules` for deploy |
| `Dockerfile` | `node:22-slim`, Cloud Run–ready container build |
| `SECURITY_CONSTITUTION.md` | AI-Studio-configured threat model, secure coding standards, secret management rules |

---

## Why the Backend Never Touches Firestore

This is the one architectural decision worth explaining explicitly, since it's easy to assume the opposite:

- The spec requires isolation to be **enforced server-side**, not just hidden in the UI.
- Firestore's own security rules engine *is* a server — every read/write request is evaluated against `firestore.rules` on Google's infrastructure, regardless of what client sent it.
- Routing writes through Cloud Run instead would just move trust from "the client's JS" to "the server's JS" — it wouldn't add isolation, it would add a second thing that could get isolation wrong.
- So Cloud Run's job is scoped down to exactly what needs a server: holding a secret and verifying identity before spending it. Nothing else.

---

## Environment Variables

| Variable | Used In | Effect if Missing |
|---|---|---|
| `GEMINI_API_KEY` | `lib/gemini.js` (local dev only) | Falls back to `GEMINI_API_KEY_SECRET_NAME` (production path) |
| `GEMINI_API_KEY_SECRET_NAME` | `lib/secrets.js` (production) | Required in production; format `projects/*/secrets/*/versions/*` |
| `GEMINI_MODEL` | `lib/gemini.js` | Defaults to `gemini-3.6-flash` if unset |
| `GOOGLE_CLOUD_PROJECT` | `lib/verifyAuth.js` (firebase-admin) | Needed for local ID token verification against the correct project |
| `PORT` | `server.js` | Defaults to `8080` |

---

*Part of [Personal Gemini Journal](./README.md) — Google Cloud Gen AI Academy APAC Edition*