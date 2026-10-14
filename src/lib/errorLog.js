// Console logging for failures, so a problem a user reports can be traced from
// DevTools (or, in the desktop app, the terminal: main.js forwards renderer
// warnings and errors). Pass the Error itself, not just its message, so the
// stack is kept. Never log provider keys or the user's project contents.

const PREFIX = '[AppBlips]';

// Something failed and the user is affected (an error shown, work not saved).
export const logError = (context, err) => {
  if (err === undefined) console.error(`${PREFIX} ${context}`);
  else console.error(`${PREFIX} ${context}:`, err);
};

// Something failed but the app carried on (a fallback, a skipped extra).
export const logWarn = (context, err) => {
  if (err === undefined) console.warn(`${PREFIX} ${context}`);
  else console.warn(`${PREFIX} ${context}:`, err);
};

// Uncaught errors are already printed by the browser; this adds the ones that
// are easy to miss: promise rejections nobody awaited, and React render errors
// (with the component stack), which otherwise blank the app silently.
export const installGlobalErrorLogging = () => {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'AbortError') return;
    logError('Unhandled promise rejection', event.reason);
  });
};

export const reactRootErrorOptions = {
  onUncaughtError: (err, info) => logError(`React render crashed${info?.componentStack ? `\nComponent stack:${info.componentStack}` : ''}`, err),
  onCaughtError: (err, info) => logError(`React error boundary caught${info?.componentStack ? `\nComponent stack:${info.componentStack}` : ''}`, err),
  onRecoverableError: (err) => logWarn('React recovered from an error', err),
};
