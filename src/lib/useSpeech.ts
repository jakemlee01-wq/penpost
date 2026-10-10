import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input through the browser's built-in speech recognition (Chrome, Edge, Safari).
 * Nothing is recorded by Penpost; the browser turns speech into text and we put it in the box.
 * Where the browser has no speech recognition, `supported` is false and the mic is hidden.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeech(getText: () => string, setText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const supported = recognitionCtor() !== null;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    const before = getText().trimEnd();
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setText(`${before}${before && said ? " " : ""}${said.trim()}`);
    };
    r.onerror = (e) =>
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access is off. You can type instead." : "Didn't catch that. Try again or type.");
    r.onend = () => setListening(false);
    setError("");
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Voice input isn't available right now. You can type instead.");
    }
  }, [getText, setText]);

  useEffect(() => () => rec.current?.stop(), []);

  return { supported, listening, error, start, stop };
}
