import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Role = "user" | "assistant";
type ChatMessage = { id: string; role: Role; content: string; emotion?: Emotion };
type Emotion = "Positive" | "Frustrated" | "Sad" | "Confused" | "Calm";
type AssistantState = "idle" | "listening" | "thinking" | "speaking";
type Language = "auto" | "en-US" | "hi-IN" | "hinglish";
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
};
type SpeechRecognitionEvent = { resultIndex: number; results: ArrayLike<SpeechRecognitionResult> };
type SpeechRecognitionErrorEvent = { error: string };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

const greetings: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "Hi, I'm Solace. What's on your mind?",
  },
];

const stateLabels: Record<AssistantState, string> = {
  idle: "Ready when you are",
  listening: "I'm listening",
  thinking: "Thinking it through",
  speaking: "Speaking",
};

function estimateEmotion(text: string): Emotion {
  const normalized = text.toLowerCase();
  if (/\b(confused|don't understand|dont understand|what do you mean|unclear|समझ नहीं|समझ नहीं आया)\b/.test(normalized)) {
    return "Confused";
  }
  if (/\b(angry|annoyed|frustrated|furious|irritated|fed up|परेशान|गुस्सा)\b/.test(normalized)) {
    return "Frustrated";
  }
  if (/\b(sad|lonely|upset|unhappy|down|heartbroken|दुखी|अकेला)\b/.test(normalized)) {
    return "Sad";
  }
  if (/\b(excited|happy|wonderful|great news|amazing|awesome|खुश|शानदार)\b/.test(normalized)) {
    return "Positive";
  }
  return "Calm";
}

function emotionIcon(emotion: Emotion): string {
  return { Positive: "✦", Frustrated: "↗", Sad: "◌", Confused: "?", Calm: "≈" }[emotion];
}

function getRecognitionConstructor(): RecognitionConstructor | undefined {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(greetings);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [assistantState, setAssistantState] = useState<AssistantState>("idle");
  const [language, setLanguage] = useState<Language>("auto");
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.85);
  const [voiceName, setVoiceName] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const recognitionRef = useRef<Recognition | null>(null);
  const pauseTimerRef = useRef<number | undefined>(undefined);
  const transcriptRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(assistantState);

  useEffect(() => {
    stateRef.current = assistantState;
  }, [assistantState]);

  useEffect(() => {
    const availableVoices = window.speechSynthesis?.getVoices() ?? [];
    setVoices(availableVoices);
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoices);
    const recognitionAvailable = Boolean(getRecognitionConstructor());
    setRecognitionSupported(recognitionAvailable);
    void fetch("/api/health")
      .then((result) => result.json() as Promise<{ configured: boolean }>)
      .then((health) => setConfigured(health.configured))
      .catch(() => setConfigured(false));
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", updateVoices);
      window.speechSynthesis?.cancel();
      window.clearTimeout(pauseTimerRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, interim]);

  const selectedLanguage = useCallback((): string => {
    if (language === "hi-IN" || language === "hinglish") return "hi-IN";
    if (language === "en-US") return "en-US";
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    return /[\u0900-\u097f]/.test(lastUserMessage) ? "hi-IN" : "en-US";
  }, [language, messages]);

  const speak = useCallback(
    (text: string) => {
      if (muted || !("speechSynthesis" in window)) {
        setAssistantState("idle");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = selectedLanguage();
      utterance.rate = speed;
      utterance.volume = volume;
      const selectedVoice = voices.find((voice) => voice.name === voiceName);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onend = () => setAssistantState("idle");
      utterance.onerror = () => {
        setAssistantState("idle");
        setError("I couldn't play the voice response. The written reply is still here.");
      };
      setAssistantState("speaking");
      window.speechSynthesis.speak(utterance);
    },
    [muted, selectedLanguage, speed, voiceName, voices, volume],
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const content = rawText.trim();
      if (!content || stateRef.current === "thinking") return;
      window.clearTimeout(pauseTimerRef.current);
      transcriptRef.current = "";
      setInterim("");
      setInput("");
      setError("");
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
      setAssistantState("thinking");
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        emotion: estimateEmotion(content),
      };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages
              .filter((message) => message.id !== "welcome")
              .map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          }),
        });
        const result = (await response.json()) as { content?: string; error?: string };
        if (!response.ok || !result.content) {
          throw new Error(result.error ?? "I couldn't get a response. Please try again.");
        }
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.content,
        };
        setMessages((current) => [...current, assistantMessage]);
        speak(result.content);
      } catch (requestError) {
        setAssistantState("idle");
        setError(requestError instanceof Error ? requestError.message : "Something went wrong. Please try again.");
      }
    },
    [messages, speak],
  );

  const startListening = () => {
    if (!recognitionSupported || assistantState === "thinking") {
      if (!recognitionSupported) setError("Speech recognition isn't supported in this browser. You can type instead.");
      return;
    }
    window.speechSynthesis?.cancel();
    setError("");
    setInterim("");
    transcriptRef.current = "";
    try {
      const RecognitionApi = getRecognitionConstructor();
      if (!RecognitionApi) {
        setRecognitionSupported(false);
        setError("Speech recognition isn't available in this browser. You can type instead.");
        return;
      }
      const recognition = new RecognitionApi();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language === "auto" ? "en-US" : language === "hinglish" ? "hi-IN" : language;
      recognition.onstart = () => {
        setAssistantState("listening");
      };
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalText += `${result[0].transcript} `;
          else interimText += result[0].transcript;
        }
        if (finalText) transcriptRef.current += finalText;
        setInterim(`${transcriptRef.current}${interimText}`.trim());
        if (transcriptRef.current.trim()) {
          window.clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = window.setTimeout(() => {
            const spokenText = transcriptRef.current.trim();
            if (spokenText) void sendMessage(spokenText);
          }, 1_200);
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("Microphone access was denied. Allow microphone access in your browser settings, or type a message.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(`Speech recognition error: ${event.error}. You can try again or type your message.`);
        }
        setAssistantState("idle");
      };
      recognition.onend = () => {
        if (stateRef.current === "listening") setAssistantState("idle");
      };
      recognitionRef.current?.abort();
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setAssistantState("idle");
      setError("Couldn't start the microphone. Check browser permissions or type a message instead.");
    }
  };

  const stopListening = () => {
    window.clearTimeout(pauseTimerRef.current);
    const spokenText = transcriptRef.current.trim();
    recognitionRef.current?.stop();
    if (spokenText) void sendMessage(spokenText);
    else {
      setAssistantState("idle");
      setInterim("");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const clearConversation = () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.abort();
    setMessages(greetings);
    setInterim("");
    transcriptRef.current = "";
    setInput("");
    setError("");
    setAssistantState("idle");
  };

  const toggleMicrophone = () => {
    if (assistantState === "listening") stopListening();
    else startListening();
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    if (assistantState === "speaking") setAssistantState("idle");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Solace home">
          <span className="brand-mark"><span /></span>
          <span>solace<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-actions">
          <span className="privacy-pill"><span className="privacy-dot" /> Private by design</span>
          <button className="icon-button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Open settings" title="Settings">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <section className="main-layout">
        <section className="conversation-panel" aria-label="Conversation">
          <div className="conversation-heading">
            <div>
              <p className="eyebrow">YOUR PERSONAL COMPANION</p>
              <h1>A little space to think.</h1>
              <p className="subheading">Talk it out, ask away, or just say hello.</p>
            </div>
            <button className="clear-button" onClick={clearConversation} disabled={messages.length <= 1} title="Clear conversation">
              <TrashIcon /> <span>Clear</span>
            </button>
          </div>

          <div className="conversation-content">
            <div className="message-list">
              {messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message.id}>
                  {message.role === "assistant" && <span className="message-avatar"><span /></span>}
                  <div className="message-body">
                    <div className="message-meta">
                      <span>{message.role === "assistant" ? "Solace" : "You"}</span>
                      {message.emotion && (
                        <span className={`emotion-tag emotion-${message.emotion.toLowerCase()}`} title="Estimated from your words only; may not reflect how you feel.">
                          {emotionIcon(message.emotion)} {message.emotion.toLowerCase()}
                        </span>
                      )}
                    </div>
                    <p>{message.content}</p>
                  </div>
                </article>
              ))}
              {interim && assistantState === "listening" && (
                <article className="message-row user interim-row">
                  <div className="message-body">
                    <div className="message-meta"><span>You</span><span className="live-label">LIVE TRANSCRIPT</span></div>
                    <p>{interim}<span className="cursor">|</span></p>
                  </div>
                </article>
              )}
              {assistantState === "thinking" && (
                <article className="message-row assistant">
                  <span className="message-avatar"><span /></span>
                  <div className="message-body">
                    <div className="message-meta"><span>Solace</span></div>
                    <div className="thinking-dots" aria-label="Solace is thinking"><i /><i /><i /></div>
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </div>
            {error && <div className="error-banner" role="alert"><span>!</span>{error}</div>}
          </div>

          <div className="composer-area">
            <div className={`voice-stage ${assistantState}`}>
              <div className="orb-wrap" aria-hidden="true">
                <div className="orb-halo" />
                <div className="orb">
                  <div className="orb-core" />
                  <div className="orb-shine" />
                  <div className="orb-wave wave-one" />
                  <div className="orb-wave wave-two" />
                </div>
              </div>
              <div className="status-line">
                <span className={`status-indicator ${assistantState}`} />
                <span>{stateLabels[assistantState]}</span>
              </div>
              <div className="voice-controls">
                <button
                  className={`mic-button ${assistantState === "listening" ? "is-listening" : ""}`}
                  onClick={toggleMicrophone}
                  aria-label={assistantState === "listening" ? "Stop listening and send" : "Start talking"}
                  disabled={assistantState === "thinking" || !recognitionSupported}
                  title={!recognitionSupported ? "Speech recognition is not supported in this browser" : "Talk to Solace"}
                >
                  {assistantState === "listening" ? <StopIcon /> : <MicIcon />}
                </button>
                {assistantState === "speaking" && (
                  <button className="stop-speech-button" onClick={stopSpeaking}><StopIcon /> Stop speaking</button>
                )}
              </div>
              <p className="mic-hint">{assistantState === "listening" ? "Tap to send what you've said" : "Tap the microphone to speak"}</p>
            </div>

            <form className="composer" onSubmit={handleSubmit}>
              <input
                aria-label="Type a message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Or type what's on your mind..."
                disabled={assistantState === "thinking"}
              />
              <button className="send-button" type="submit" aria-label="Send message" disabled={!input.trim() || assistantState === "thinking"}>
                <SendIcon />
              </button>
            </form>
            <p className="privacy-note"><LockIcon /> Not saved by Solace · Message text goes to your AI provider.</p>
          </div>
        </section>

        <aside className="side-panel">
          <section className="side-card now-card">
            <div className="card-heading"><span className="card-icon sparkle-icon">✧</span><div><p className="eyebrow">RIGHT HERE WITH YOU</p><h2>Your moment</h2></div></div>
            <p className="moment-copy">
              {assistantState === "listening" ? "Take your time. I'm listening." :
                assistantState === "thinking" ? "Putting a thoughtful answer together." :
                  assistantState === "speaking" ? "Sharing a reply with you." :
                    "No rush. Start wherever you are."}
            </p>
            <div className="moment-footer"><span className="mini-wave"><i /><i /><i /><i /><i /><i /><i /></span><span>{assistantState === "idle" ? "Here, whenever" : stateLabels[assistantState]}</span></div>
          </section>

          <section className="side-card settings-card">
            <div className="card-heading"><span className="card-icon sliders-icon"><SlidersIcon /></span><div><p className="eyebrow">MAKE IT YOURS</p><h2>Voice & language</h2></div></div>
            <label className="setting-field">
              <span>Language</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="auto">Auto detect</option>
                <option value="en-US">English</option>
                <option value="hi-IN">Hindi</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </label>
            <label className="setting-field">
              <span>Voice</span>
              <select value={voiceName} onChange={(event) => setVoiceName(event.target.value)} disabled={voices.length === 0}>
                <option value="">{voices.length ? "System default" : "Browser default"}</option>
                {voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}
              </select>
            </label>
            <label className="range-field">
              <span><span>Speaking speed</span><span>{speed.toFixed(1)}×</span></span>
              <input type="range" min="0.7" max="1.3" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            </label>
            <label className="range-field">
              <span><span>Volume</span><span>{Math.round(volume * 100)}%</span></span>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </label>
            <button className={`mute-toggle ${muted ? "muted" : ""}`} onClick={() => { setMuted((current) => !current); if (!muted) stopSpeaking(); }}>
              <VolumeIcon muted={muted} /><span>{muted ? "Voice muted" : "Mute voice"}</span><span className={`toggle-track ${muted ? "on" : ""}`}><i /></span>
            </button>
          </section>

          <section className="side-card privacy-card">
            <div className="privacy-card-heading"><LockIcon /><span>YOUR PRIVACY MATTERS</span></div>
            <ul>
              <li><CheckIcon /> Solace stores no audio recordings</li>
              <li><CheckIcon /> No saved chat history</li>
              <li><CheckIcon /> AI key stays on the server</li>
            </ul>
            <p>Speech recognition is provided by your browser. Transcripts are sent to your configured AI provider to generate replies.</p>
          </section>

          {configured === false && (
            <div className="setup-notice" role="status">
              <span className="notice-dot" />
              <p><strong>One quick setup step</strong><br />Add your <code>LLM_API_KEY</code> to <code>.env</code> to enable AI replies.</p>
            </div>
          )}
          {!recognitionSupported && <p className="browser-notice">Speech recognition is unavailable here. Typing and voice playback still work.</p>}
          <button className="settings-mobile-trigger" onClick={() => setSettingsOpen((open) => !open)}><SettingsIcon /> {settingsOpen ? "Hide settings" : "Voice & privacy settings"}</button>
        </aside>
      </section>
      <footer className="page-footer"><span>Made for the moments in between.</span><span>Solace <i>·</i> A thoughtful voice companion</span></footer>
      {settingsOpen && (
        <div className="settings-drawer" role="dialog" aria-modal="true" aria-label="Voice settings">
          <div className="drawer-heading"><div><p className="eyebrow">PREFERENCES</p><h2>Voice settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><CloseIcon /></button></div>
          <label className="setting-field">
            <span>Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="auto">Auto detect</option>
              <option value="en-US">English</option>
              <option value="hi-IN">Hindi</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </label>
          <label className="setting-field">
            <span>Voice</span>
            <select value={voiceName} onChange={(event) => setVoiceName(event.target.value)} disabled={voices.length === 0}>
              <option value="">{voices.length ? "System default" : "Browser default"}</option>
              {voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>)}
            </select>
          </label>
          <label className="range-field">
            <span><span>Speaking speed</span><span>{speed.toFixed(1)}×</span></span>
            <input type="range" min="0.7" max="1.3" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
          </label>
          <label className="range-field">
            <span><span>Volume</span><span>{Math.round(volume * 100)}%</span></span>
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
          </label>
          <button className={`mute-toggle ${muted ? "muted" : ""}`} onClick={() => { setMuted((current) => !current); if (!muted) stopSpeaking(); }}>
            <VolumeIcon muted={muted} /><span>{muted ? "Voice muted" : "Mute voice"}</span><span className={`toggle-track ${muted ? "on" : ""}`}><i /></span>
          </button>
          <p className="drawer-status">Speech recognition: {recognitionSupported ? "Available in this browser" : "Not supported; typing remains available"}</p>
          <button className="drawer-clear" onClick={() => { clearConversation(); setSettingsOpen(false); }}><TrashIcon /> Clear conversation</button>
        </div>
      )}
    </main>
  );
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></svg>;
}
function StopIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5 16-3.5-7.5L4 12Z" /><path d="m11.5 12.5 4-4" /></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(0 2) scale(.83)" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg>; }
function SlidersIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8m4 0h4M4 17h4m4 0h8M12 4v6m-4 4v6" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5" /></svg>; }
function VolumeIcon({ muted }: { muted: boolean }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z" />{muted ? <path d="m17 9 5 6m0-6-5 6" /> : <><path d="M16 9a5 5 0 0 1 0 6" /><path d="M18.5 6.5a9 9 0 0 1 0 11" /></>}</svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }

export default App;
