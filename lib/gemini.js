const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const { getGeminiApiKey } = require("./secrets");

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.6-flash";

let genAI = null;
async function getClient() {
  if (!genAI) {
    const apiKey = await getGeminiApiKey();
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Multi-turn journal/brainstorm chat.
 * `history` is [{ role: "user"|"model", parts: [{ text }] }, ...] — the
 * client resends the running conversation each turn so state lives in
 * Firestore (client-owned), not in server memory.
 */
async function sendChatMessage(history, message) {
  const client = await getClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(message);
  return result.response.text();
}

const RDI_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    summary: {
      type: SchemaType.STRING,
      description: "2-4 sentence neutral summary of what the user journaled about this session.",
    },
    rdi_score: {
      type: SchemaType.NUMBER,
      description:
        "Reflection Depth Index, 0-100. Higher = more specific, more self-examining, more follow-through language.",
    },
    rdi_reasoning: {
      type: SchemaType.STRING,
      description: "1-2 sentences on why this score was given, citing specificity/self-examination/follow-through.",
    },
  },
  required: ["summary", "rdi_score", "rdi_reasoning"],
};

const RDI_PROMPT = `You are scoring a personal journal/brainstorm session for its "Reflection Depth Index" (RDI).

Score 0-100 based on three signals present in the conversation below:
1. Specificity — concrete details vs vague generalities.
2. Self-examination — does the user analyze their own reasoning, feelings, or assumptions?
3. Follow-through language — does the user commit to a next step or action?

Be honest and calibrated: a short, vague session should score low (0-30). A deeply
specific, self-examining session with a clear next step should score high (70-100).

Conversation transcript:
---
{{TRANSCRIPT}}
---

Return only the structured fields requested.`;

/**
 * Called once, when the user ends a session. Takes the full transcript
 * text and returns { summary, rdi_score, rdi_reasoning }. The client
 * writes this result into Firestore itself (rule-gated), the server
 * never touches the database.
 */
async function scoreSession(transcriptText) {
  const client = await getClient();
  const model = client.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RDI_SCHEMA,
    },
  });

  const prompt = RDI_PROMPT.replace("{{TRANSCRIPT}}", transcriptText);
  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text());

  // Clamp defensively — never trust the model's number range blindly.
  parsed.rdi_score = Math.max(0, Math.min(100, Math.round(parsed.rdi_score)));
  return parsed;
}

module.exports = { sendChatMessage, scoreSession };
