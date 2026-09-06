# Personal Gemini Journal

Firebase-authenticated Gemini journaling app with Firestore-isolated storage
and Secret Manager-backed key handling, deployed on Cloud Run.

Built solo by Ashish Kumar ([@ashish-doing](https://github.com/ashish-doing)),
B.Tech ECE, IIIT Guwahati.

## What it does

Sign in, journal/brainstorm with Gemini across a multi-turn conversation, end
the session to get an automatic summary plus a **Reflection Depth Index (RDI)**
— a 0–100 score of how specific, self-examining, and action-oriented the
session was — tracked as a running trend on your dashboard.

## Architecture

- **Auth**: Firebase Authentication (email/password), client-side.
- **Data**: Cloud Firestore, written directly by the client SDK, gated by
  `firestore.rules` (`request.auth.uid == userId`) — isolation is enforced by
  Firestore itself, not hidden in the UI.
- **AI**: Gemini API (`@google/generative-ai`), called only from the Cloud Run
  backend, which never touches Firestore — its only job is proxying the model
  call after verifying the caller's Firebase ID token.
- **Secrets**: Gemini API key lives in Google Cloud Secret Manager, fetched at
  runtime by the backend. Never in the client bundle, never committed.
- See `SECURITY_CONSTITUTION.md` for the full threat model.

## 1. One-time setup

You'll need a Google Cloud project **with billing enabled** (Cloud Run +
Secret Manager both require it — the free tier covers hackathon-scale usage).

```bash
# Install CLIs if you don't have them
npm install -g firebase-tools
# gcloud: https://cloud.google.com/sdk/docs/install

gcloud auth login
gcloud config set project YOUR_PROJECT_ID

firebase login
firebase use --add   # pick/create the same project
```

In the [Firebase console](https://console.firebase.google.com/):
1. Add a web app to your project → copy the `firebaseConfig` object.
2. Paste it into `public/index.html` in place of the `REPLACE_ME` values.
3. Authentication → Sign-in method → enable **Email/Password**.
4. Firestore Database → create database (production mode is fine, rules below override defaults).

## 2. Store the Gemini key in Secret Manager

Get a key from [Google AI Studio](https://aistudio.google.com/apikey), then:

```bash
gcloud services enable secretmanager.googleapis.com run.googleapis.com

echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key \
  --data-file=- --replication-policy=automatic
```

## 3. Local development

```bash
npm install
cp .env.example .env
# edit .env — for local dev, just paste GEMINI_API_KEY=<your key> (simplest path)

# firebase-admin needs local credentials too:
gcloud auth application-default login

npm run dev
# open http://localhost:8080
```

## 4. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

## 5. Deploy to Cloud Run

The code calls Secret Manager's API directly (`lib/secrets.js`) rather than
relying on Cloud Run's implicit secret-mounting, so the retrieval is visible
in the repo, not just in deploy config. Pass it the secret's resource name:

```bash
gcloud run deploy personal-gemini-journal \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY_SECRET_NAME=projects/YOUR_PROJECT_ID/secrets/gemini-api-key/versions/latest
```

Grant the Cloud Run service account read access to that one secret
(least privilege — not project-wide):

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

The deploy prints a public `https://...run.app` URL — that's your **Working
Prototype Link** for the submission form. Test it from an incognito window
before you consider it done.

## Why this stack (Q&A prep)

- **Firebase Auth** — fastest correct way to get real user identity that
  Firestore rules can key off of natively.
- **Firestore over another DB** — its security rules give server-enforced
  per-user isolation without writing a permissions layer by hand.
- **Structured JSON output for RDI, not free text** — a fixed schema
  (`summary`, `rdi_score`, `rdi_reasoning`) is directly renderable and
  chartable; parsing free text would be fragile and non-deterministic.
- **Secret Manager over env vars** — env vars on Cloud Run are visible to
  anyone with read access to the service config; Secret Manager adds
  versioning, audit logging, and per-secret IAM.
