// Pollinations (pollinations.ai) values shared by the server handler
// (electron/server/pollinationsApi.js) and the page (connectors, prompts).
//
// AppBlips' App Key is publishable: it only names AppBlips on Pollinations'
// approval screen and can't spend anything itself, so it is safe in the
// renderer bundle and in pages. It is used for the user's sign-in in Settings
// (whose secret user key stays server-side) and for the visitor sign-in in
// the pages the AI builds when the user picks "visitors pay"
// (pollinationsHelper.js).
export const POLLINATIONS_APP_KEY = 'pk_bdWHQEDiqu4FZpa2';

// Whether developer earnings are on for that App Key (Pollinations' dashboard,
// Apps). With them on, everything spent through the key costs 25% more and
// the extra goes to AppBlips' account, so Settings and the visitor Connect
// button say so. Keep this in step with the dashboard.
export const POLLINATIONS_EARNINGS = true;
export const POLLINATIONS_FEE_NOTE = 'Using Pollinations through AppBlips costs 25% more than using it directly. The extra supports AppBlips. This applies to your own images and, if you choose “Visitors use their own Pollen”, to your visitors’ AI use too.';
export const POLLINATIONS_VISITOR_FEE_NOTE = 'Includes a small fee that supports AppBlips.';

export const POLLINATIONS_AUTH = 'https://enter.pollinations.ai';
export const POLLINATIONS_API = 'https://gen.pollinations.ai';
export const POLLINATIONS_MEDIA = 'https://media.pollinations.ai';

// Cheap defaults the AI is told to use (live list: GET /image/models, /text/models).
export const POLLINATIONS_IMAGE_MODEL = 'tongyi-mai/z-image-turbo';
export const POLLINATIONS_TEXT_MODEL = 'openai/gpt-5.4-nano';

// More new images than this in one build is almost certainly a loop or a
// misunderstanding, and each one spends the user's Pollen.
export const MAX_IMAGES_PER_BUILD = 12;

// An image URL the AI wrote for AppBlips to generate (see resolveImages in
// pollinations.js): a complete literal https://gen.pollinations.ai/image/…
// URL that ends at a quote, a closing parenthesis or a tag. URLs built at run
// time (template literals, string concatenation) are the app's own and are
// left alone, as are URLs that already carry a key.
export const POLLINATIONS_IMAGE_URL_RE = /https:\/\/gen\.pollinations\.ai\/image\/[^\s"'`()<>{}$\\]+(?=["')<])/g;
