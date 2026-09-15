import { useEffect } from 'react';

// Mobile keyboards can resize the visual viewport without resizing CSS dvh.
export default function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame;
    const update = () => {
      if (viewport && viewport.scale !== 1) return;
      const style = document.documentElement.style;
      style.setProperty('--app-viewport-height', (viewport?.height ?? window.innerHeight) + 'px');
      style.setProperty('--app-viewport-top', (viewport?.offsetTop ?? 0) + 'px');
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.style.removeProperty('--app-viewport-top');
    };
  }, []);
}
