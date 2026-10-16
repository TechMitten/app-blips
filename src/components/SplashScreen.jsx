import { useState, useEffect, useRef } from 'react';
const splashImg = '/blackblipsbg.webp';

// The image slowly fades in, holds, then the whole splash slowly fades out.
const FADE_IN_MS = 1600;
const HOLD_MS = 1400;
const FADE_OUT_MS = 1600;
// Skipping (button or Esc) uses a quicker fade so it doesn't feel ignored.
const SKIP_FADE_MS = 500;

export default function SplashScreen({ skip = false }) {
  const [isVisible, setIsVisible] = useState(!skip);
  const [isImageShown, setIsImageShown] = useState(false);
  const [fadeOutMs, setFadeOutMs] = useState(null);
  const endedRef = useRef(false);
  const imgRef = useRef(null);
  const timersRef = useRef([]);
  const startedRef = useRef(false);

  const endSplash = (duration) => {
    if (endedRef.current) return;
    endedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    setFadeOutMs(duration);
    timersRef.current = [setTimeout(() => setIsVisible(false), duration)];
  };
  const skipSplash = () => endSplash(SKIP_FADE_MS);

  const startFadeIn = () => {
    if (endedRef.current || startedRef.current) return;
    startedRef.current = true;
    setIsImageShown(true);
    timersRef.current.push(setTimeout(() => endSplash(FADE_OUT_MS), FADE_IN_MS + HOLD_MS));
  };

  useEffect(() => {
    if (skip) return;
    // A cached image can finish loading before React attaches onLoad.
    if (imgRef.current?.complete && imgRef.current.naturalWidth) startFadeIn();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') skipSplash();
    };
    document.addEventListener('keydown', handleKeyDown);
    const timers = timersRef;
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      timers.current.forEach(clearTimeout);
      // StrictMode re-runs this effect; let the re-run restart the timeline
      // instead of leaving the splash stuck with its timer cleared.
      startedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  if (!isVisible) return null;

  const isFading = fadeOutMs !== null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex h-dvh items-center justify-center overflow-hidden bg-black transition-opacity ease-in-out ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${fadeOutMs ?? 0}ms` }}
    >
      <img
        ref={imgRef}
        src={splashImg}
        alt="AppBlips"
        decoding="async"
        onLoad={startFadeIn}
        // A missing image shouldn't leave a black screen up.
        onError={skipSplash}
        className={`max-h-[38dvh] w-[38vw] object-contain transition-opacity ease-in-out ${
          isImageShown ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transitionDuration: `${FADE_IN_MS}ms`,
          // The image's dark-grey edges would show as a box on the black
          // backdrop at this size; feather them away.
          maskImage: 'radial-gradient(ellipse, black 45%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse, black 45%, transparent 75%)'
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
