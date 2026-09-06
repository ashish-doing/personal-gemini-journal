const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

const client = new SecretManagerServiceClient();

let cachedKey = null;

/**
 * Fetches the Gemini API key from Google Cloud Secret Manager once,
 * then caches it in memory for the life of the container instance.
 * Never logs the value. Never returned to the client.
 *
 * Requires either:
 *  - GEMINI_API_KEY_SECRET_NAME env var set to the full resource name
 *    (projects/PROJECT_ID/secrets/gemini-api-key/versions/latest), or
 *  - GEMINI_API_KEY set directly for local dev only (see .env.example).
 */
async function getGeminiApiKey() {
  if (cachedKey) return cachedKey;

  // Local dev escape hatch — never set this in production, use Secret Manager instead.
  if (process.env.GEMINI_API_KEY) {
    cachedKey = process.env.GEMINI_API_KEY;
    return cachedKey;
  }

  const secretName = process.env.GEMINI_API_KEY_SECRET_NAME;
  if (!secretName) {
    throw new Error(
      "GEMINI_API_KEY_SECRET_NAME is not set. Point it at your Secret Manager resource, e.g. " +
        "projects/<PROJECT_ID>/secrets/gemini-api-key/versions/latest"
    );
  }

  const [version] = await client.accessSecretVersion({ name: secretName });
  cachedKey = version.payload.data.toString("utf8");
  return cachedKey;
}

module.exports = { getGeminiApiKey };
