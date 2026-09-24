import useElapsedSeconds from '../hooks/useElapsedSeconds';

// Live "12s" counter for the reasoning window. Its own component so the
// once-a-second tick re-renders only this text, not the preview around it.
export default function ThinkingElapsed({ since }) {
  const seconds = useElapsedSeconds(since);
  return <span className="tabular-nums">{seconds}s</span>;
}
