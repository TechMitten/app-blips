import React, { useState, useEffect } from 'react';

export default function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // Start fading out after 1.5 seconds
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 1500);

    // Completely remove from DOM after the fade transition completes
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
    }, 2000); // 1500ms + 500ms for transition

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <img 
        src="/appblips-logo.png" 
        alt="AppBlips Text to App Generator" 
        className="w-72 sm:w-96 md:w-[32rem] max-w-[90vw] h-auto object-contain" 
      />
    </div>
  );
}
