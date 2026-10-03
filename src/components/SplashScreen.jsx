import { useState, useEffect, useRef } from 'react';
import { markSplashShown } from '../lib/config';
const splashVid = '/newsplash.webm';

const Starfield = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const stars = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 1.5 + 0.1,
      vx: (Math.random() - 0.5) * 0.1, 
      vy: (Math.random() - 0.5) * 0.1,
      alpha: Math.random(),
      alphaChange: (Math.random() - 0.5) * 0.015,
      color: `hsla(${220 + Math.random() * 60}, ${Math.random() * 30 + 70}%, ${Math.random() * 20 + 80}%, `
    }));

    let animationFrameId;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      stars.forEach(star => {
        star.x += star.vx;
        star.y += star.vy;
        
        if (star.x < 0) star.x = canvas.width;
        if (star.x > canvas.width) star.x = 0;
        if (star.y < 0) star.y = canvas.height;
        if (star.y > canvas.height) star.y = 0;

        star.alpha += star.alphaChange;
        if (star.alpha <= 0.1 || star.alpha >= 1) {
          star.alphaChange = -star.alphaChange;
        }
        
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `${star.color}${star.alpha})`;
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />;
};

export default function SplashScreen({ skip = false }) {
  const [isVisible, setIsVisible] = useState(!skip);
  const [isFading, setIsFading] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const endedRef = useRef(false);

  const handleVideoEnd = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setIsFading(true);
    setTimeout(() => {
      setIsVisible(false);
    }, 500); // 500ms for transition
  };

  useEffect(() => {
    if (skip) return;
    // Stamped on show rather than on finish, so reloading mid-intro doesn't
    // replay it either.
    markSplashShown();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleVideoEnd();
    };
    document.addEventListener('keydown', handleKeyDown);
    // Switching tabs pauses the (control-less) video in most browsers and
    // doesn't reliably resume it on return, so just skip the splash instead
    // of leaving it stuck.
    const handleVisibilityChange = () => {
      if (document.hidden) handleVideoEnd();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [skip]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex h-dvh flex-col items-center justify-center overflow-hidden bg-black transition-opacity duration-500 ease-in-out ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <Starfield />
      <video 
        src={splashVid} 
        autoPlay
        muted
        playsInline
        preload="auto"
        onCanPlay={(e) => {
          e.currentTarget.playbackRate = 1.85;
          setIsVideoReady(true);
        }}
        onEnded={handleVideoEnd}
        className={`relative z-10 h-auto max-h-[76dvh] w-screen max-w-[100vw] shrink-0 scale-[0.8] object-contain mix-blend-screen transition-opacity duration-700 sm:w-[72rem] sm:max-w-[180vw] sm:max-h-none sm:scale-[0.5] md:max-w-[115vw] ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
        style={{
          maskImage: 'radial-gradient(ellipse, black 35%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse, black 35%, transparent 80%)'
        }}
      />
      <button
        type="button"
        onClick={handleVideoEnd}
        className="absolute z-20 text-sm text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:text-white focus-visible:underline focus-visible:outline-none"
        style={{
          right: 'max(1.5rem, env(safe-area-inset-right))',
          bottom: 'max(1.5rem, env(safe-area-inset-bottom))'
        }}
      >
        Skip video
      </button>
    </div>
  );
}
