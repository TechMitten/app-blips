// The Showcase: projects built with AppBlips, opened from the studio picker.
// The examples are the same exports as appblips.com/showcase, bundled in
// public/showcase so they open offline. People submit their own published
// projects through Web3Forms (lib/appblipsInbox.js); nothing is listed until
// the AppBlips team adds it to SHOWCASE_PROJECTS by hand.
import { COOLDOWN_MS, EMAIL_RE, looksLikeBot, postToAppBlipsInbox } from './appblipsInbox.js';

export const SHOWCASE_SITE_URL = 'https://www.appblips.com/showcase';

// `file` is a bundled export in public/showcase; it is fetched and shown as
// srcdoc in a sandboxed frame, since the app's own pages are served with
// frame-ancestors 'none'. `url` is where it lives on the web (opened in the
// browser). An approved submission has only `url` (and `author`) and is
// framed from there, still sandboxed.
export const SHOWCASE_PROJECTS = [
  {
    name: 'Florist',
    category: 'Flower shop',
    kind: 'website',
    description: 'A garden-inspired flower shop with bouquet filters, subscriptions, wedding florals, and a delivery checker.',
    file: 'florist.html',
    background: '#f7ecec',
  },
  {
    name: 'RealOne',
    category: 'Real estate',
    kind: 'website',
    description: 'A luxury real estate website with property listings, neighborhood guides, and an interactive mortgage calculator.',
    file: 'realone.html',
    background: '#0e1416',
  },
  {
    name: 'PetCare',
    category: 'Pet grooming & daycare',
    kind: 'website',
    description: 'A cheerful pet grooming and daycare studio with service pricing, pet of the month gallery, and online booking.',
    file: 'petcare.html',
    background: '#fff8ee',
  },
  {
    name: 'Pinball Hero',
    category: 'Arcade game',
    kind: 'game',
    description: 'A playable neon pinball game with flippers, bumpers, multiball, high scores, and keyboard or touch controls.',
    file: 'pinball-hero.html',
    thumbnail: '/showcase/pinball.webp',
    background: '#0a0320',
  },
  {
    name: 'PaperGlide',
    category: 'Arcade game',
    kind: 'game',
    description: 'Throw a paper plane with a drag-and-release launch, ride updrafts, dodge obstacles, collect stars, and beat your longest flight.',
    file: 'paperglide.html',
    background: '#0b1020',
  },
  {
    name: 'Shooter',
    category: '3D arena shooter',
    kind: 'game',
    description: 'A fast first-person 3D arena shooter where you survive escalating waves of hostile drones and aliens on desktop or phone.',
    file: 'shooter.html',
    background: '#05070f',
  },
  {
    name: "Ray's Barber Shop",
    category: 'Barber shop',
    kind: 'website',
    description: 'An old-school Brooklyn barber shop website with service menus, barber profiles, an interactive map, and online chair booking.',
    file: 'ray-s-barber-shop.html',
    background: '#0b0b0d',
  },
].map((project) => ({
  ...project,
  url: project.url || `${SHOWCASE_SITE_URL}/${project.file}`,
}));

export const showcaseAction = (project) => (project.kind === 'game' ? 'Play game' : project.kind === 'app' ? 'Open app' : 'Explore website');

// Bundled exports are fetched once per session; the gallery's thumbnails and
// the full-size viewer share the text.
const docCache = new Map();
export const loadShowcaseDoc = (file) => {
  if (!docCache.has(file)) {
    const request = fetch(`/showcase/${file}`).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    request.catch(() => docCache.delete(file));
    docCache.set(file, request);
  }
  return docCache.get(file);
};

// --- Submissions -----------------------------------------------------------

export const SUBMISSION_KINDS = [
  { key: 'app', label: 'App' },
  { key: 'website', label: 'Website' },
  { key: 'game', label: 'Game' },
];
export const MAX_NAME_LENGTH = 100;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_URL_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 1000;

// The normalized address, or '' when it isn't a public http(s) page.
export const normalizeProjectUrl = (value = '') => {
  let text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.username || url.password) return '';
  const host = url.hostname.toLowerCase();
  // Localhost and bare IPs only work on the sender's own machine/network.
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')
    || /^[\d.]+$/.test(host) || host.startsWith('[')) return '';
  return url.href;
};

// '' when the form can be sent, otherwise what to fix.
export const validateShowcaseSubmission = ({
  name = '', email = '', projectName = '', projectUrl = '', kind = '', consent = false,
}) => {
  if (!name.trim()) return 'Enter your name.';
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address so we can tell you when it’s approved.';
  if (!projectName.trim()) return 'Enter your project’s name.';
  if (!projectUrl.trim()) return 'Enter the address where your project is published.';
  if (!normalizeProjectUrl(projectUrl)) return 'That address doesn’t look right. Use the public link to your published project, starting with https://';
  if (!SUBMISSION_KINDS.some((option) => option.key === kind)) return 'Choose whether it’s an app, website or game.';
  if (!consent) return 'Tick the box to let us feature your project.';
  return '';
};

const SENT_MESSAGE = 'Thanks! Your project was submitted.';
let lastSentAt = -Infinity;

// Resolves to { ok, message }; never throws. `message` is shown to the user.
// `botcheck` is the hidden honeypot's value, `openedAt` when the form opened.
export const sendShowcaseSubmission = async (
  {
    name = '', email = '', projectName = '', projectUrl = '', kind = '', description = '', consent = false,
    botcheck = false, openedAt = -Infinity,
  },
  { fetchImpl = fetch, signal, now = Date.now } = {},
) => {
  const problem = validateShowcaseSubmission({ name, email, projectName, projectUrl, kind, consent });
  if (problem) return { ok: false, message: problem };
  const time = now();
  if (looksLikeBot({ botcheck, openedAt }, time)) return { ok: true, message: SENT_MESSAGE };
  if (time - lastSentAt < COOLDOWN_MS) {
    return { ok: false, message: 'You just submitted a project. Please wait a minute before sending another.' };
  }
  const title = projectName.trim().slice(0, MAX_PROJECT_NAME_LENGTH);
  const result = await postToAppBlipsInbox({
    subject: `Showcase submission: ${title}`,
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    // Web3Forms uses `email` as the reply-to, so approving is one reply away.
    email: email.trim(),
    project_name: title,
    project_url: normalizeProjectUrl(projectUrl),
    project_type: SUBMISSION_KINDS.find((option) => option.key === kind).label,
    description: description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || '(none)',
    permission_to_feature: 'Yes',
  }, { fetchImpl, signal });
  if (!result.ok) return result;
  lastSentAt = time;
  return { ok: true, message: SENT_MESSAGE };
};
