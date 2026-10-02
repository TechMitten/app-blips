// Sign-up / password-reset address checks. Every confirmation or reset mail
// sent to an address that doesn't exist bounces, and Supabase throttles a
// project's auth mail once its bounce rate climbs. Most bad addresses are
// typos in a big provider's domain, so catch those before anything is sent.

const KNOWN_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'protonmail.ch', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com',
  'email.com', 'mail.ru', 'fastmail.com', 'yandex.com', 'zoho.com',
  'qq.com', '163.com', 'comcast.net', 'verizon.net', 'att.net',
];

// Typos too far from the real domain for the edit-distance check below.
const KNOWN_TYPOS = {
  'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com', 'g.mail.com': 'gmail.com',
  'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'outlook.con': 'outlook.com', 'outlook.co': 'outlook.com',
  'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'icloud.con': 'icloud.com', 'icloud.co': 'icloud.com',
};

const COMMON_TLD_TYPOS = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', nte: 'net', ogr: 'org' };

// Damerau-Levenshtein (adjacent transpositions count as one edit).
const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
};

// Stricter than <input type="email">, which accepts "me@localhost".
export const isPlausibleEmail = (email) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(String(email || '').trim());

// Returns the corrected address when the domain looks like a typo of a
// well-known provider, otherwise null.
export const suggestEmailFix = (email) => {
  const trimmed = String(email || '').trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!domain || KNOWN_DOMAINS.includes(domain)) return null;

  let fixed = KNOWN_TYPOS[domain] || null;
  // Short domains sit one edit away from too many real ones (web.dk, gmx.at).
  if (!fixed && domain.length >= 8) {
    let best = null;
    let bestDistance = Infinity;
    for (const known of KNOWN_DOMAINS) {
      const distance = editDistance(domain, known);
      if (distance < bestDistance) { best = known; bestDistance = distance; }
    }
    // Anything further than one edit is more likely a real domain we don't
    // know (hotmail.fr, outlook.de) than a typo.
    if (bestDistance === 1) fixed = best;
  }
  if (!fixed) {
    const dot = domain.lastIndexOf('.');
    const tld = dot > 0 ? domain.slice(dot + 1) : '';
    if (COMMON_TLD_TYPOS[tld]) fixed = `${domain.slice(0, dot)}.${COMMON_TLD_TYPOS[tld]}`;
  }
  return fixed && fixed !== domain ? `${local}@${fixed}` : null;
};
