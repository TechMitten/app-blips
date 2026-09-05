import React, { useState, useEffect, useRef } from 'react';
import splashVid from '../assets/splashvid.webm';

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

export default function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);

  const handleVideoEnd = () => {
    setIsFading(true);
    setTimeout(() => {
      setIsVisible(false);
    }, 500); // 500ms for transition
  };

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${
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
        onCanPlay={() => setIsVideoReady(true)}
        onEnded={handleVideoEnd}
        className={`relative z-10 w-72 sm:w-96 md:w-[32rem] max-w-[90vw] h-auto object-contain mix-blend-screen transition-opacity duration-700 ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
        style={{
          maskImage: 'radial-gradient(circle, black 50%, transparent 95%)',
          WebkitMaskImage: 'radial-gradient(circle, black 50%, transparent 95%)'
        }}
      />
    </div>
  );
}
