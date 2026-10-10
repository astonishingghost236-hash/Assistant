import "dotenv/config";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const maxMessageLength = 8_000;
const maxConversationMessages = 40;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", configured: Boolean(process.env.LLM_API_KEY) });
});

app.post("/api/chat", async (request, response) => {
  const messages: unknown = request.body?.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > maxConversationMessages ||
    !messages.every(
      (message): message is ChatMessage =>
        typeof message === "object" &&
        message !== null &&
        ((message as ChatMessage).role === "user" || (message as ChatMessage).role === "assistant") &&
        typeof (message as ChatMessage).content === "string" &&
        (message as ChatMessage).content.trim().length > 0 &&
        (message as ChatMessage).content.length <= maxMessageLength,
    )
  ) {
    response.status(400).json({ error: "Send a valid conversation with up to 40 messages." });
    return;
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    response.status(503).json({
      error: "AI is not configured yet. Add your provider key as LLM_API_KEY in .env and restart the server.",
    });
    return;
  }

  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "You are a friendly, thoughtful personal voice assistant. Reply in the language and mix of languages the user uses (English, Hindi, or Hinglish). Be conversational, clear, and concise enough to sound natural aloud. Adapt gently to the emotional tone the user expresses, without assuming feelings, diagnosing, or claiming human emotions. Be honest when uncertain; never invent facts. Ask a focused follow-up question only when it helps.",
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      response.status(502).json({
        error:
          upstream.status === 401
            ? "The AI provider rejected the configured API key."
            : `The AI provider returned an error (${upstream.status}). Please try again.`,
      });
      return;
    }

    const result: unknown = await upstream.json();
    const content =
      typeof result === "object" &&
      result !== null &&
      "choices" in result &&
      Array.isArray(result.choices) &&
      typeof result.choices[0]?.message?.content === "string"
        ? result.choices[0].message.content.trim()
        : "";

    if (!content) {
      response.status(502).json({ error: "The AI provider returned an empty response. Please try again." });
      return;
    }
    response.json({ content });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The AI took too long to respond. Please try again."
        : "Could not reach the AI provider. Check your connection and provider settings.";
    response.status(502).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Assistant API listening on http://localhost:${port}`);
});
