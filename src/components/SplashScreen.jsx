import { useState, useEffect, useRef } from 'react';
const splashVideo = '/animatedsplash.mp4';

// The video is silent and fades itself to black in its last second, so the
// splash simply ends when it does; the short fade-out below only hides the
// final black frame.
const END_FADE_MS = 300;
const FADE_IN_MS = 1000;
// Skipping (button or Esc) uses a quicker fade so it doesn't feel ignored.
const SKIP_FADE_MS = 500;

// `onDone` runs once it has gone (played out, skipped or failed), so the
// app can keep it from playing again when a different screen mounts its own
// copy. `aboveSetup` draws it over the first-run setup screen (z-index
// 1000), which is the first thing a new desktop install shows.
export default function SplashScreen({ skip = false, onDone, aboveSetup = false }) {
  const [isVisible, setIsVisible] = useState(!skip);
  const [fadeOutMs, setFadeOutMs] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const endedRef = useRef(false);
  const timersRef = useRef([]);

  const endSplash = (duration) => {
    if (endedRef.current) return;
    endedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    setFadeOutMs(duration);
    timersRef.current = [setTimeout(() => { setIsVisible(false); onDone?.(); }, duration)];
  };
  const skipSplash = () => endSplash(SKIP_FADE_MS);

  useEffect(() => {
    if (skip) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') skipSplash();
    };
    document.addEventListener('keydown', handleKeyDown);
    const timers = timersRef;
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  if (!isVisible) return null;

  const isFading = fadeOutMs !== null;

  return (
    <div
      className={`fixed inset-0 z-100 flex h-dvh items-center justify-center overflow-hidden bg-black transition-opacity ease-in-out ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${fadeOutMs ?? 0}ms`, ...(aboveSetup ? { zIndex: 1400 } : null) }}
    >
      {/* Capped at 960 CSS px (the video is 2560 wide, so this is sharp even
          on high-DPI screens) so it sits centered instead of filling the
          window; smaller screens scale it down. */}
      <div className="relative max-h-full w-full max-w-[960px]">
        <video
          src={splashVideo}
          autoPlay
          muted
          playsInline
          aria-label="AppBlips"
          // Fade in once frames are actually showing, not while it buffers.
          onPlaying={() => setIsPlaying(true)}
          onEnded={() => endSplash(END_FADE_MS)}
          // A missing or undecodable video shouldn't leave a black screen up.
          onError={skipSplash}
          className={`block max-h-dvh w-full object-contain transition-opacity ease-in-out ${
            isPlaying ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDuration: `${FADE_IN_MS}ms` }}
        />
        {/* The video's grey haze would show as a box on the black backdrop
            when it doesn't fill the screen, so its edges fade to black. This
            is a black overlay rather than a mask-image on the video: Chromium
            re-applies a mask on every decoded frame and sometimes paints a
            frame unmasked, which made the edges flicker during playback. On
            the black backdrop the result looks the same. closest-side makes
            it fully black at the middle of every edge (the default reached
            only the corners, leaving visible edges). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse closest-side, transparent 70%, black 100%)'
          }}
        />
      </div>
      <button
        type="button"
        onClick={skipSplash}
        className="absolute z-20 text-sm text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:text-white focus-visible:underline focus-visible:outline-none"
        style={{
          right: 'max(1.5rem, env(safe-area-inset-right))',
          bottom: 'max(1.5rem, env(safe-area-inset-bottom))'
        }}
      >
        Skip
      </button>
    </div>
  );
}
