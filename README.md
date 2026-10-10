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
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_MODEL=gpt-4o-mini
   ```

   Create an API key through your provider's account dashboard. For OpenAI, use the API keys page at <https://platform.openai.com/api-keys>. The key is only read by the Express server and is never sent to the browser. The model name and base URL can be changed for another compatible provider.

3. Start the frontend and API server:

   ```sh
   npm run dev
   ```

4. Open the Vite URL printed in the terminal (normally <http://localhost:5173>).

For a production bundle, run `npm run build`. Run the API server with `npm start`; serve the generated `dist/` directory from a static host or reverse proxy `/api` requests to the server.

## Features

- English, Hindi, and Hinglish chat instructions, with browser speech recognition language selection and language auto-detection for speech playback.
- Continuous interim transcription while the microphone is active; a pause after a final recognition result sends that turn. The mic button also stops listening and sends any recognized text.
- Typed chat fallback and in-tab conversation context for follow-up questions.
- Browser-native speech synthesis with available voice selection, speed, volume, mute, and stop-speaking controls.
- An explicitly approximate text-only tone estimate; no voice-based emotion analysis or mental-health diagnosis.
- No transcript or audio persistence by this app. Conversation context exists in page memory and is sent to your configured AI provider when you ask a question. Clear resets the in-tab conversation.

## Browser and provider limitations

- `SpeechRecognition` / `webkitSpeechRecognition` is not supported by every browser. Browser implementations may use the browser vendor's remote recognition service and require network access and microphone permission. This app does not record or upload raw audio itself; check your browser's privacy information for its speech service. Typing remains available when recognition is unavailable.
- Speech synthesis voice options and Hindi/Hinglish pronunciation depend on voices installed by the operating system or browser. TTS is local to the browser where supported; the app falls back to displaying text if speech playback fails.
- The chat API requires a configured provider key and may incur provider charges. Without a key, the app surfaces a setup error and still supports its interface and typed input.
- Text submitted for an AI response is sent to the provider configured in `.env`. The app does not log or persist message bodies.

## Scripts

- `npm run dev` — start Vite and the Express API together
- `npm run typecheck` — type-check the frontend and server
- `npm run build` — type-check and build the frontend
- `npm start` — start the Express API server
