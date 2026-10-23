# AppBlips — logo files

Pure vector SVGs; the text is outlined (no font needed). Wordmark and mark have transparent backgrounds.
Typeface reference: Montserrat SemiBold.

## Brand colors
| Token | Light theme | Dark theme |
|-------|-------------|------------|
| Ink   | `#0A0A0A`   | `#FFFFFF`  |
| Blip (red dot) | `#E9604F` | `#EC6452` |
| App tile | `#0A0A0A` | `#0A0A0A` |

## Files
| File | Use |
|------|-----|
| `wordmark-*.svg` | "AppBlips" logotype — site header, docs, footer |
| `mark-*.svg` | The wave and blip (red dot) with no tile — small spaces, inline UI |
| `app-icon.svg` | Rounded black tile with the white wave and blip — works on light *and* dark backgrounds |
| `app-icon-inverted.svg` | White tile, black wave — for dark pages where you want the tile to stand out |
| `app-icon-square.svg` | Full-bleed square — source for iOS / App Store (they round it themselves) |
| `app-icon-maskable.svg` | Android / PWA maskable icon (art inside the safe zone) |
| `favicon.svg` | Same as app-icon |
| `og-image.svg` | 1200×630 social share card |

Suffixes: `-light` (for light backgrounds), `-dark` (for dark backgrounds), `-auto` (switches with the visitor's OS setting, works in `<img>`), `-inline` (paste into HTML, colors from CSS variables), `-mono-black` / `-mono-white`.

## Recipes
```html
<!-- Follows the OS light/dark setting -->
<img src="/brand/wordmark-auto.svg" alt="AppBlips" height="32">

<!-- Site with its own theme toggle: swap files -->
<img class="logo-l" src="/brand/wordmark-light.svg" alt="AppBlips" height="32">
<img class="logo-d" src="/brand/wordmark-dark.svg" alt="" aria-hidden="true" height="32">
<style>.logo-d{display:none}[data-theme=dark] .logo-l{display:none}[data-theme=dark] .logo-d{display:inline}</style>

<!-- or paste wordmark-inline.svg and set: -->
<style>:root{--ab-ink:#0A0A0A;--ab-dot:#E9604F}[data-theme=dark]{--ab-ink:#fff;--ab-dot:#EC6452}</style>

<!-- Favicons / app icons -->
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/png/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/brand/png/apple-touch-icon.png">
<meta property="og:image" content="https://YOUR-DOMAIN/brand/png/og-image-1200x630.png">
```

PWA manifest icons: `png/app-icon-192.png`, `png/app-icon-512.png`, and `png/app-icon-maskable-512.png` with `"purpose": "maskable"`.
`png/app-store-1024.png` is the 1024×1024 App Store / Play Store source.
