import "dotenv/config";
import express, { type NextFunction } from "express";

const app = express();
const maxMessageLength = 8_000;
const maxConversationMessages = 40;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

async function getProviderError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "object" &&
      parsed.error !== null &&
      "message" in parsed.error &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message.slice(0, 240);
    }
  } catch {
    return "The provider returned an unreadable error response.";
  }
  return "The provider did not explain the error.";
}

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  response.json({
    status: "ok",
    configured: Boolean(process.env.LLM_API_KEY),
    provider: baseUrl.includes("openrouter.ai") ? "OpenRouter" : "OpenAI-compatible",
  });
});

app.post(
  "/api/transcribe",
  express.raw({
    type: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"],
    limit: "25mb",
  }),
  async (request, response) => {
    const audio = request.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      response.status(400).json({ error: "No audio was received. Record a short message and try again." });
      return;
    }

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      response.status(503).json({
        error: "Transcription needs an API key. Add LLM_API_KEY to .env and restart the server.",
      });
      return;
    }

    const contentType = request.header("content-type")?.split(";")[0]?.toLowerCase();
    const fileExtension =
      contentType === "audio/mp4"
        ? "mp4"
        : contentType === "audio/mpeg"
          ? "mp3"
          : contentType === "audio/ogg"
            ? "ogg"
            : contentType === "audio/wav" || contentType === "audio/x-wav"
              ? "wav"
              : "webm";
    const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    try {
      const isOpenRouter = new URL(baseUrl).hostname === "openrouter.ai";
      const headers = { Authorization: `Bearer ${apiKey}` };
      let upstream: Response;

      if (isOpenRouter) {
        const format = fileExtension === "mp4" ? "m4a" : fileExtension;
        upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.LLM_TRANSCRIPTION_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
            max_tokens: 1_000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Transcribe the speech in this audio verbatim. Preserve the language spoken, including Hindi-English code-switching. Return only the transcript, with no commentary.",
                  },
                  {
                    type: "input_audio",
                    input_audio: { data: audio.toString("base64"), format },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } else {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), `recording.${fileExtension}`);
        form.append("model", process.env.LLM_TRANSCRIPTION_MODEL ?? "whisper-1");
        if (request.header("x-speech-language") === "hi-IN") form.append("language", "hi");
        if (request.header("x-speech-language") === "en-US") form.append("language", "en");
        upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers,
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      }

      if (!upstream.ok) {
        const providerError = await getProviderError(upstream);
        response.status(502).json({
          error:
            upstream.status === 401
              ? `The AI provider rejected the configured API key. ${providerError}`
              : upstream.status === 402
                ? `The AI provider account has no available credits for this request. ${providerError}`
                : upstream.status === 429
                  ? `The AI provider rate limit was reached. ${providerError}`
                  : `Transcription provider error (${upstream.status}): ${providerError}`,
        });
        return;
      }

      const result: unknown = await upstream.json();
      let text =
        typeof result === "object" && result !== null && "text" in result && typeof result.text === "string"
          ? result.text.trim()
          : "";
      if (
        !text &&
        typeof result === "object" &&
        result !== null &&
        "choices" in result &&
        Array.isArray(result.choices)
      ) {
        const content: unknown = result.choices[0]?.message?.content;
        if (typeof content === "string") text = content.trim();
        else if (Array.isArray(content)) {
          text = content
            .filter((part): part is { text: string } => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string")
            .map((part) => part.text)
            .join("")
            .trim();
        }
      }
      if (!text) {
        response.status(502).json({ error: "The transcription provider returned no speech. Try speaking a little longer." });
        return;
      }
      response.json({ text });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "Audio transcription timed out. Try a shorter recording."
          : "Could not reach the transcription provider. Check your connection and provider settings.";
      response.status(502).json({ error: message });
    }
  },
);

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
      const providerError = await getProviderError(upstream);
      response.status(502).json({
        error:
          upstream.status === 401
            ? `The AI provider rejected the configured API key. ${providerError}`
            : upstream.status === 402
              ? `The AI provider account has no available credits for this model. ${providerError}`
              : upstream.status === 429
                ? `The AI provider rate limit was reached. ${providerError}`
                : `The AI provider returned an error (${upstream.status}): ${providerError}`,
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

app.use((error: unknown, _request: express.Request, response: express.Response, next: NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    response.status(413).json({ error: "Audio is too large. Record a shorter voice message and try again." });
    return;
  }
  next(error);
});

export default app;
