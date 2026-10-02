// Re-sends the sign-up confirmation email to every unconfirmed user, for
// recovering from a period when auth mail was rate limited.
//
//   node --env-file=.env scripts/resend-confirmations.js            # dry run: counts only
//   node --env-file=.env scripts/resend-confirmations.js --send     # actually send
//
// Options:
//   --max=N          send at most N this run, leaving the rest of the mail
//                    provider's daily quota for new sign-ups (default 40)
//   --per-hour=N     pace sends to stay under the project's email rate limit (default 25)
//   --skip-recent=H  skip users who were sent a confirmation in the last H hours (default 1),
//                    so re-running after a 429 picks up where the last run stopped
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Addresses are never
// printed. Addresses that fail the sign-up form's checks (lib/emailCheck.js)
// are skipped, since they would only bounce again.
import { createClient } from '@supabase/supabase-js';
import { isPlausibleEmail, suggestEmailFix } from '../src/lib/emailCheck.js';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const send = args.send === 'true';
const max = Number(args.max || 40);
const perHour = Number(args['per-hour'] || 25);
const skipRecentMs = Number(args['skip-recent'] || 1) * 3600 * 1000;

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. node --env-file=.env ...).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const listAllUsers = async () => {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const users = await listAllUsers();
const unconfirmed = users.filter((user) => user.email && !user.email_confirmed_at && !user.banned_until);
const counts = { unconfirmed: unconfirmed.length, invalid: 0, typo: 0, recent: 0 };
const queue = unconfirmed.filter((user) => {
  if (!isPlausibleEmail(user.email)) { counts.invalid++; return false; }
  if (suggestEmailFix(user.email)) { counts.typo++; return false; }
  const sentAt = Date.parse(user.confirmation_sent_at || '');
  if (sentAt && Date.now() - sentAt < skipRecentMs) { counts.recent++; return false; }
  return true;
});

console.log(`Unconfirmed users: ${counts.unconfirmed}`);
console.log(`  skipped, invalid address: ${counts.invalid}`);
console.log(`  skipped, likely typo: ${counts.typo}`);
console.log(`  skipped, sent within the last ${skipRecentMs / 3600000}h: ${counts.recent}`);
queue.splice(max);
console.log(`To send this run: ${queue.length}${counts.unconfirmed - counts.invalid - counts.typo - counts.recent > max ? ` (capped by --max=${max}; for the rest, re-run tomorrow with --skip-recent=30 so today's recipients aren't mailed twice)` : ''}`);
if (!send) {
  console.log('Dry run. Re-run with --send to send.');
  process.exit(0);
}

const gapMs = Math.ceil(3600 * 1000 / perHour);
let sent = 0;
for (const [index, user] of queue.entries()) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
  // 429 is Supabase's hourly limit; a 5xx is usually the SMTP provider
  // refusing (e.g. its daily quota is used up). Either way, stop here.
  if (error?.status === 429 || error?.status >= 500) {
    console.log(`Stopped after ${sent} sent: ${error.code || error.status} ${error.message}`);
    console.log('Re-run later; already-sent users are skipped.');
    process.exit(2);
  }
  if (error) console.log(`#${index + 1} failed: ${error.code || error.status || ''} ${error.message}`);
  else sent++;
  console.log(`${sent}/${queue.length} sent`);
  if (index < queue.length - 1) await sleep(gapMs);
}
console.log(`Done: ${sent} sent.`);
