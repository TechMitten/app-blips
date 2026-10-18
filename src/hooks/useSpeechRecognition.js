import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '../lib/errorLog';

// Speech-to-text with Whisper running on this computer (src/lib/whisperWorker.js).
// The Web Speech API this replaced sends audio to the browser vendor and has
// no service at all in Electron. Here the microphone is recorded until the
// user stops, then the whole clip is transcribed locally: nothing is uploaded,
// and it works the same in the desktop app and the browser version.

const SAMPLE_RATE = 16000; // what Whisper expects
// Bounds memory (and transcription time) if the mic is left on.
const MAX_RECORDING_MS = 2 * 60 * 1000;

const ERROR_MESSAGES = {
  NotAllowedError: 'Microphone access is blocked. Allow it in your system or browser settings to use voice input.',
  SecurityError: 'Microphone access is blocked. Allow it in your system or browser settings to use voice input.',
  NotFoundError: 'No microphone was found.',
  NotReadableError: 'The microphone is in use by another app.',
};

const isSupported = () => (
  typeof window !== 'undefined'
  && typeof Worker !== 'undefined'
  && typeof window.MediaRecorder !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
);

// One worker for the whole app, created on first use and kept, so the model
// (a few seconds to load) is only loaded once per session.
let worker = null;
let nextRequestId = 1;
const pending = new Map();

function whisperRequest(message, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('../lib/whisperWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.type === 'error') request.reject(new Error(data.message));
      else request.resolve(data);
    };
    worker.onerror = (event) => {
      // A worker that fails to start answers nothing; fail everything waiting
      // and start a fresh one next time.
      const err = new Error(event.message || 'The voice model could not start.');
      for (const request of pending.values()) request.reject(err);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });
}

async function decodeToMono16k(blob) {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    // decodeAudioData resamples to the context's rate.
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer.getChannelData(0).slice();
  } finally {
    context.close().catch(() => {});
  }
}

// `onTranscript(text)` is called once per recording with the transcribed
// text, after the user stops (or the time limit is reached).
export default function useSpeechRecognition({ onTranscript }) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const sessionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const supported = isSupported();

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const releaseMic = (session) => {
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
  };

  // Drop the session without delivering anything further -- used when the
  // caller is about to overwrite the text (submit, manual edit, unmount).
  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.cancelled = true;
      if (session.recorder?.state === 'recording') {
        try { session.recorder.stop(); } catch { /* already stopped */ }
      }
      releaseMic(session);
    }
    setListening(false);
    setTranscribing(false);
  }, []);

  // Graceful stop: the recording is transcribed and delivered.
  const stop = useCallback(() => {
    const recorder = sessionRef.current?.recorder;
    if (recorder?.state === 'recording') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!isSupported() || sessionRef.current) return;
    setError(null);
    const session = { cancelled: false, chunks: [] };
    sessionRef.current = session;
    // Start loading the model now, so it's ready by the time the user stops.
    whisperRequest({ type: 'load' }).catch(() => { /* reported when transcribing */ });

    try {
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      sessionRef.current = null;
      if (!session.cancelled) setError(ERROR_MESSAGES[err?.name] || 'Voice input could not start. Try again.');
      return;
    }
    if (session.cancelled) {
      releaseMic(session);
      return;
    }

    const recorder = new MediaRecorder(session.stream);
    session.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onstop = async () => {
      releaseMic(session);
      if (session.cancelled) return;
      setListening(false);
      if (session.chunks.length === 0) {
        sessionRef.current = null;
        return;
      }
      setTranscribing(true);
      try {
        const audio = await decodeToMono16k(new Blob(session.chunks, { type: recorder.mimeType }));
        const language = (navigator.language || '').split('-')[0].toLowerCase() || undefined;
        const { text } = await whisperRequest({ type: 'transcribe', audio, language }, [audio.buffer]);
        if (!session.cancelled && text) onTranscriptRef.current?.(text);
      } catch (err) {
        logError('Voice input failed', err);
        if (!session.cancelled) setError('Voice input could not understand that recording. Try again.');
      } finally {
        if (sessionRef.current === session) {
          sessionRef.current = null;
          setTranscribing(false);
        }
      }
    };
    recorder.start();
    session.timer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, MAX_RECORDING_MS);
    setListening(true);
  }, []);

  useEffect(() => cancel, [cancel]);

  return { supported, listening, transcribing, error, start, stop, cancel };
}
