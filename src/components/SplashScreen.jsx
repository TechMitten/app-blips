import { useState, useEffect, useRef } from 'react';
const splashVideo = '/animatedsplash.mp4';

// The video is silent and fades itself to black in its last 1.5s, so the
// splash simply ends when it does; the short fade-out below only hides the
// final black frame.
const END_FADE_MS = 300;
const FADE_IN_MS = 1000;
// One notch above normal speed. Set at runtime rather than re-encoding, which
// would cost the video another generation of quality.
const PLAYBACK_RATE = 1.5;
// Skipping (button or Esc) uses a quicker fade so it doesn't feel ignored.
const SKIP_FADE_MS = 500;

export default function SplashScreen({ skip = false }) {
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
    timersRef.current = [setTimeout(() => setIsVisible(false), duration)];
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
      style={{ transitionDuration: `${fadeOutMs ?? 0}ms` }}
    >
      <video
        src={splashVideo}
        autoPlay
        muted
        playsInline
        aria-label="AppBlips"
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = PLAYBACK_RATE;
        }}
        // Fade in once frames are actually showing, not while it buffers.
        onPlaying={() => setIsPlaying(true)}
        onEnded={() => endSplash(END_FADE_MS)}
        // A missing or undecodable video shouldn't leave a black screen up.
        onError={skipSplash}
        // Capped at 1280 CSS px (the video is 2560 wide, so this is sharp even
        // on high-DPI screens); smaller screens scale it down.
        className={`max-h-full w-full max-w-[1280px] object-contain transition-opacity ease-in-out ${
          isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transitionDuration: `${FADE_IN_MS}ms`,
          // The video's grey haze would show as a box on the black backdrop
          // when it doesn't fill the screen. closest-side makes the mask fully
          // transparent at the middle of every edge (the default reached only
          // the corners, leaving visible edges), so it blends seamlessly.
          maskImage: 'radial-gradient(ellipse closest-side, black 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse closest-side, black 70%, transparent 100%)'
        }}
      />
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
