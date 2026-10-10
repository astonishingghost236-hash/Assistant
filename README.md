# Solace — Personal AI Voice Assistant

A private-by-default voice and text assistant built with React, TypeScript, Vite, and Express. It uses the browser's speech APIs for microphone transcription and spoken replies, and a server-side OpenAI-compatible chat endpoint for contextual AI responses.

## Requirements

- Node.js 20 or newer
- A modern browser; Chromium-based browsers generally provide the best Web Speech API support
- An API key from an OpenAI-compatible chat provider for AI answers

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`, then set `LLM_API_KEY`:

   ```dotenv
   LLM_API_KEY=your-provider-api-key
   LLM_BASE_URL=https://openrouter.ai/api/v1
   LLM_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
   LLM_TRANSCRIPTION_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
   ```

   Create an OpenRouter API key at <https://openrouter.ai/settings/keys>. The default OpenRouter model is a free-tier model and may be subject to rate limits or availability changes. The key is only read by the Express server and is never sent to the browser. For OpenAI directly, use <https://platform.openai.com/api-keys>, set `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL=gpt-4o-mini`, and `LLM_TRANSCRIPTION_MODEL=whisper-1`.

3. Start the frontend and API server:

   ```sh
   npm run dev
   ```

4. Open the Vite URL printed in the terminal (normally <http://localhost:5173>).

For a production bundle, run `npm run build`. Run the API server with `npm start`; serve the generated `dist/` directory from a static host or reverse proxy `/api` requests to the server.

## Features

- English, Hindi, and Hinglish chat instructions, with browser speech recognition language selection and language auto-detection for speech playback.
- Continuous interim transcription while the microphone is active; a pause after a final recognition result sends that turn. The mic button also stops listening and sends any recognized text.
- If browser speech recognition returns a network error, users can opt in to record locally and upload the recording to the configured OpenAI-compatible transcription endpoint. A separate consent prompt is shown first; recordings are limited to 90 seconds and 25 MB and are not saved by this app.
- Typed chat fallback and in-tab conversation context for follow-up questions.
- Browser-native speech synthesis with available voice selection, speed, volume, mute, and stop-speaking controls.
- An explicitly approximate text-only tone estimate; no voice-based emotion analysis or mental-health diagnosis.
- No transcript or audio persistence by this app. Conversation context exists in page memory and is sent to your configured AI provider when you ask a question. Clear resets the in-tab conversation.

## Browser and provider limitations

- `SpeechRecognition` / `webkitSpeechRecognition` is not supported by every browser. Browser implementations may use the browser vendor's remote recognition service and require network access and microphone permission. If that service is unavailable, the optional provider transcription fallback requires a configured key and provider support for `/audio/transcriptions` (OpenAI uses `whisper-1`). Audio is uploaded only after consent. Typing remains available.
- Speech synthesis voice options and Hindi/Hinglish pronunciation depend on voices installed by the operating system or browser. TTS is local to the browser where supported; the app falls back to displaying text if speech playback fails.
- The chat API and provider transcription fallback require a configured provider key. For the default OpenRouter configuration, create a key at <https://openrouter.ai/settings/keys>, place it in the local `.env` as `LLM_API_KEY`, and restart `npm run dev`. The configured free-tier model can be rate-limited or unavailable; paid models may require credits and incur charges. Do not share or commit the key. Without a key, AI responses and provider transcription are unavailable, but typed input and browser-native voice playback remain available.
- OpenRouter may require account credits to process audio even when the selected text-chat model is free. This account reported a minimum `$0.50` balance requirement for audio; add credits in the OpenRouter dashboard before using the opt-in audio fallback.
- Text submitted for an AI response is sent to the provider configured in `.env`. The app does not log or persist message bodies.

## Scripts

- `npm run dev` — start Vite and the Express API together
- `npm run typecheck` — type-check the frontend and server
- `npm run build` — type-check and build the frontend
- `npm start` — start the Express API server
