import { useState } from 'react';
import { Play, Shuffle } from 'lucide-react';
import { fallbackGradient, KIND_LABELS } from '../../lib/showcase';

// Grid tile: 16:10 thumbnail (or a gradient with the title), then the title
// and a one-line description. The whole card opens the project.
export default function ShowcaseCard({ project, onOpen, index = 0 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = imgFailed ? null : project.thumbnail;

  return (
    <article className="showcase-card group" style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}>
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        className="showcase-card-media"
        aria-label={`Open ${project.title}`}
      >
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="showcase-card-img"
          />
        ) : (
          <div className="showcase-card-fallback" style={{ background: fallbackGradient(project.id) }}>
            <span>{project.title}</span>
          </div>
        )}
        <span className="showcase-card-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
        <span className="showcase-kind" aria-hidden="true">{KIND_LABELS[project.kind]}</span>
        {project.source && (
          <span className="showcase-chip-remix" aria-hidden="true">
            <Shuffle size={11} /> Remix
          </span>
        )}
      </button>

      <div className="showcase-card-meta">
        <h3 className="showcase-card-title" title={project.title}>{project.title}</h3>
        {project.description && <p className="showcase-card-desc">{project.description}</p>}
      </div>
    </article>
  );
}
