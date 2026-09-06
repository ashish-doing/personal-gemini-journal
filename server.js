require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { verifyAuth } = require("./lib/verifyAuth");
const { sendChatMessage, scoreSession } = require("./lib/gemini");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Threat model note (see SECURITY_CONSTITUTION.md) ---
// This server NEVER reads or writes Firestore. All persistence happens
// client-side, gated by Firestore security rules keyed on request.auth.uid.
// This server's only job is holding the Gemini API key server-side and
// authenticating the caller before spending it.

app.post("/api/chat", verifyAuth, async (req, res) => {
  try {
    const { history, message } = req.body;
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    if (message.length > 8000) {
      return res.status(400).json({ error: "message too long" });
    }
    const safeHistory = Array.isArray(history) ? history : [];

    const reply = await sendChatMessage(safeHistory, message);
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "Failed to get a response. Try again." });
  }
});

app.post("/api/end-session", verifyAuth, async (req, res) => {
  try {
    const { transcript } = req.body;
    if (typeof transcript !== "string" || !transcript.trim()) {
      return res.status(400).json({ error: "transcript is required" });
    }
    if (transcript.length > 40000) {
      return res.status(400).json({ error: "transcript too long" });
    }

    const result = await scoreSession(transcript);
    res.json(result);
  } catch (err) {
    console.error("end-session error:", err);
    res.status(500).json({ error: "Failed to score session. Try again." });
  }
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on :${PORT}`));
