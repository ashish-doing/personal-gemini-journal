const admin = require("firebase-admin");

// Uses Application Default Credentials — on Cloud Run this is the
// service account attached to the service. Locally, run:
//   gcloud auth application-default login
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Express middleware: verifies the Firebase ID token sent in the
 * Authorization header (Bearer <idToken>) and attaches req.uid.
 * This is what stops someone from calling /api/* and claiming to be
 * a different uid than they actually are.
 */
async function verifyAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!idToken) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <idToken>" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error("Auth verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired ID token" });
  }
}

module.exports = { verifyAuth };
