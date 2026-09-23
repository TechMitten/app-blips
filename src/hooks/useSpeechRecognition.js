import { useCallback, useEffect, useRef, useState } from 'react';

// Browser speech-to-text via the Web Speech API. There is no transcription
// endpoint behind /api/chat, so this runs entirely in the browser: Chromium
// browsers (Chrome, Edge, Safari) expose it, and the audio is processed by the
// browser vendor's speech service, not by AppBlips. Where it is missing
// (Firefox, most embedded WebViews) `supported` is false and callers should
// simply not offer the control.

const getRecognitionCtor = () => (
  typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null
);

const ERROR_MESSAGES = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to use voice input.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings to use voice input.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input needs an internet connection.',
  'language-not-supported': 'Voice input does not support your language here.',
};

// `onTranscript(text)` receives the full transcript of the current listening
// session (finalized + still-interim words) on every update, so the caller can
// replace rather than append and never has to reconcile partial results.
export default function useSpeechRecognition({ onTranscript }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const supported = Boolean(getRecognitionCtor());

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  // Drop the session without delivering anything further -- used when the
  // caller is about to overwrite the text (submit, manual edit, unmount).
  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    setListening(false);
  }, []);

  // Graceful stop: pending words are still delivered before the session ends.
  const stop = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;
    setError(null);
    const recognition = new Ctor();
    // Mobile Chrome repeats phrases in continuous mode, so touch devices get
    // one utterance per tap instead.
    recognition.continuous = !window.matchMedia('(pointer: coarse)').matches;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
      onTranscriptRef.current?.(text);
    };
    recognition.onerror = (event) => {
      // Silence and our own abort() are not failures worth surfacing.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(ERROR_MESSAGES[event.error] || 'Voice input failed. Try again.');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError('Voice input could not start. Try again.');
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return { supported, listening, error, start, stop, cancel };
}
