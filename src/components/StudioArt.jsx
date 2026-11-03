// Small code-drawn scenes at the top of the studio picker's cards, so each
// studio shows what it makes instead of relying on an icon: a phone app, a
// web page, a platform game. Plain SVG (no image files, nothing to load
// offline), coloured entirely by studio-choice.css (.art-* classes) so they
// follow the theme and each card's accent. They come alive on hover/focus
// (the card is the .group); prefers-reduced-motion keeps them still.

function AppArt() {
  return (
    <>
      {/* Side widgets first so the phone overlaps them. */}
      <g className="art-pop art-pop-left">
        <rect className="art-panel" x="20" y="58" width="50" height="38" rx="6" />
        <rect className="art-bar art-bar-1" x="28" y="78" width="6" height="12" rx="1.5" />
        <rect className="art-bar art-bar-2" x="38" y="72" width="6" height="18" rx="1.5" />
        <rect className="art-bar art-bar-3" x="48" y="82" width="6" height="8" rx="1.5" />
        <rect className="art-bar art-bar-4" x="58" y="68" width="6" height="22" rx="1.5" />
        <rect className="art-muted" x="28" y="63" width="22" height="3" rx="1.5" />
      </g>
      <g className="art-pop art-pop-right">
        <rect className="art-panel" x="130" y="22" width="52" height="20" rx="6" />
        <circle className="art-accent" cx="140" cy="32" r="4" />
        <rect className="art-strong" x="148" y="27" width="26" height="3.5" rx="1.75" />
        <rect className="art-muted" x="148" y="34" width="18" height="3" rx="1.5" />
      </g>

      <rect className="art-device" x="74" y="8" width="52" height="104" rx="10" />
      <rect className="art-muted" x="92" y="13" width="16" height="3" rx="1.5" />
      <circle className="art-track" cx="100" cy="42" r="13" />
      <circle
        className="art-ring"
        cx="100"
        cy="42"
        r="13"
        pathLength="100"
        transform="rotate(-90 100 42)"
      />
      <rect className="art-strong" x="94" y="40" width="12" height="4" rx="2" />
      {[66, 79, 92].map((y, i) => (
        <g key={y} className={`art-row art-row-${i + 1}`}>
          <circle className={i === 0 ? 'art-accent' : 'art-muted'} cx="86" cy={y + 2} r="3" />
          <rect className="art-muted" x="92" y={y} width="26" height="4" rx="2" />
        </g>
      ))}
    </>
  );
}

function WebsiteArt() {
  return (
    <>
      <defs>
        <clipPath id="studio-art-page">
          <rect x="31" y="27" width="138" height="80" rx="0" />
        </clipPath>
      </defs>
      <rect className="art-device" x="30" y="10" width="140" height="98" rx="9" />
      <line className="art-divider" x1="30" y1="26" x2="170" y2="26" />
      <circle className="art-muted" cx="40" cy="18" r="2.2" />
      <circle className="art-muted" cx="47" cy="18" r="2.2" />
      <circle className="art-muted" cx="54" cy="18" r="2.2" />
      <rect className="art-muted" x="68" y="15" width="70" height="6" rx="3" />

      {/* The page scrolls inside the window on hover. */}
      <g clipPath="url(#studio-art-page)">
        <g className="art-scroll">
          <rect className="art-accent" x="40" y="33" width="18" height="4" rx="2" />
          <rect className="art-muted" x="120" y="34" width="10" height="3" rx="1.5" />
          <rect className="art-muted" x="134" y="34" width="10" height="3" rx="1.5" />
          <rect className="art-muted" x="148" y="34" width="12" height="3" rx="1.5" />

          <rect className="art-strong" x="40" y="47" width="66" height="7" rx="2.5" />
          <rect className="art-strong" x="40" y="57" width="48" height="7" rx="2.5" />
          <rect className="art-muted" x="40" y="68" width="56" height="3.5" rx="1.75" />
          <rect className="art-accent" x="40" y="76" width="26" height="9" rx="4.5" />
          <rect className="art-panel" x="116" y="45" width="44" height="40" rx="5" />
          <circle className="art-muted" cx="128" cy="57" r="4" />
          <path className="art-hill" d="M118 83 L132 68 L142 76 L150 70 L158 83 Z" />

          {[40, 82, 124].map((x) => (
            <g key={x}>
              <rect className="art-panel" x={x} y="94" width="36" height="28" rx="4" />
              <rect className="art-muted" x={x + 5} y="100" width="18" height="3" rx="1.5" />
              <rect className="art-muted" x={x + 5} y="106" width="24" height="3" rx="1.5" />
            </g>
          ))}
          <rect className="art-strong" x="40" y="132" width="54" height="6" rx="2.5" />
          <rect className="art-muted" x="40" y="142" width="120" height="3" rx="1.5" />
          <rect className="art-muted" x="40" y="148" width="100" height="3" rx="1.5" />
        </g>
      </g>
    </>
  );
}

function GameArt() {
  return (
    <>
      <rect className="art-device" x="20" y="10" width="160" height="100" rx="10" />
      {[[42, 26], [70, 20], [150, 30], [112, 22], [164, 48]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="art-star" cx={cx} cy={cy} r="1.3" />
      ))}
      {/* Score: three life pips, top right. */}
      <rect className="art-accent" x="146" y="17" width="6" height="6" rx="1.5" />
      <rect className="art-accent" x="155" y="17" width="6" height="6" rx="1.5" />
      <rect className="art-muted" x="164" y="17" width="6" height="6" rx="1.5" />

      <rect className="art-panel" x="66" y="70" width="36" height="6" rx="2" />
      <rect className="art-panel" x="118" y="52" width="36" height="6" rx="2" />
      <circle className="art-coin art-coin-1" cx="84" cy="60" r="4" />
      <circle className="art-coin art-coin-2" cx="136" cy="42" r="4" />

      <line className="art-ground" x1="20" y1="96" x2="180" y2="96" />
      <rect className="art-enemy" x="140" y="86" width="12" height="10" rx="5" />
      <g className="art-player">
        <rect className="art-accent" x="38" y="82" width="14" height="14" rx="3.5" />
        <rect className="art-eye" x="46" y="86" width="3" height="3.5" rx="1" />
      </g>
    </>
  );
}

const SCENES = { app: AppArt, website: WebsiteArt, game: GameArt };

export default function StudioArt({ studio }) {
  const Scene = SCENES[studio];
  if (!Scene) return null;
  return (
    <span className="studio-art" aria-hidden="true">
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" focusable="false">
        <Scene />
      </svg>
    </span>
  );
}
