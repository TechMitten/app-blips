// Operator dashboard for the per-account usage counters written by
// functions/_lib/usageTracking.js (see Docs/USAGE_TRACKING.md).
//
//   npm run usage            → http://127.0.0.1:5178  (Ctrl+C to stop)
//
// Reads the whole `usage` collection over the Firestore REST API using the
// logged-in Firebase CLI's own Google identity (the same class of access as
// `gcloud auth print-access-token` / the Firebase console -- IAM-based, so
// firestore.rules don't apply). Account uids are resolved to emails the same
// way, via the admin Identity Toolkit endpoint. Self-hosted installs have no
// usage collection, so this is a hosted-mode tool. Binds to loopback only and
// never exposes the OAuth token to the served page -- the page talks to this
// server, and this server talks to Google.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { firebaseProjectId } from '../functions/_lib/firebaseServer.js';

// firebase-tools' public installed-app OAuth client (the same constants the
// CLI itself embeds), used to exchange the stored login refresh token.
const OAUTH_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const configstorePath = () => {
  if (process.env.FIREBASE_TOOLS_CONFIG) return process.env.FIREBASE_TOOLS_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || `${os.homedir()}/.config`;
  return `${base}/configstore/firebase-tools.json`;
};

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.token;

  let refreshToken;
  try {
    const stored = JSON.parse(fs.readFileSync(configstorePath(), 'utf8'));
    refreshToken = stored.tokens?.refresh_token;
  } catch {
    throw new Error('Could not read the Firebase CLI credentials file. Run `firebase login` first.');
  }
  if (!refreshToken) {
    throw new Error('No Firebase CLI refresh token found. Run `firebase login` first.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed (HTTP ${res.status}). Run \`firebase login\`. ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: now + ((data.expires_in || 3600) - 120) * 1000 };
  return cachedToken.token;
}

async function fetchUsageDocs() {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId(process.env)}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'usage' }] } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Firestore query failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }
  const entries = await res.json();
  const intOf = (field) => (field?.integerValue ? parseInt(field.integerValue, 10) || 0 : 0);
  return entries
    .filter((entry) => entry.document)
    .map((entry) => {
      const fields = entry.document.fields || {};
      return {
        uid: fields.user_id?.stringValue || '(unknown)',
        date: fields.date?.stringValue || '',
        builder: intOf(fields.builderRequests),
        deployed: intOf(fields.deployedRequests),
        builderTokens: intOf(fields.builderTokens),
        deployedTokens: intOf(fields.deployedTokens),
      };
    })
    .filter((doc) => doc.date);
}

const utcOffsetDay = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const lastNDates = (n) => Array.from({ length: n }, (_, i) => utcOffsetDay(n - 1 - i));

function aggregate(docs) {
  const today = utcOffsetDay(0);
  const days30 = lastNDates(30);
  const week = new Set(days30.slice(-7));
  const month = new Set(days30);

  const users = new Map();
  const totals = {
    today: { builder: 0, deployed: 0, total: 0, builderTokens: 0, deployedTokens: 0, totalTokens: 0 },
    week: { builder: 0, deployed: 0, total: 0, builderTokens: 0, deployedTokens: 0, totalTokens: 0 },
    allTime: { builder: 0, deployed: 0, total: 0, builderTokens: 0, deployedTokens: 0, totalTokens: 0 },
  };
  const active = { today: new Set(), week: new Set(), allTime: new Set() };

  for (const doc of docs) {
    const row = doc.builder + doc.deployed;
    const rowTokens = doc.builderTokens + doc.deployedTokens;
    let user = users.get(doc.uid);
    if (!user) {
      user = { uid: doc.uid, builder: 0, deployed: 0, builderTokens: 0, deployedTokens: 0, daily: {}, dailyTokens: {}, todayBuilder: 0, todayDeployed: 0, todayBuilderTokens: 0, todayDeployedTokens: 0 };
      users.set(doc.uid, user);
    }
    user.builder += doc.builder;
    user.deployed += doc.deployed;
    user.builderTokens += doc.builderTokens;
    user.deployedTokens += doc.deployedTokens;
    user.daily[doc.date] = (user.daily[doc.date] || 0) + row;
    user.dailyTokens[doc.date] = (user.dailyTokens[doc.date] || 0) + rowTokens;
    if (doc.date === today) {
      user.todayBuilder += doc.builder;
      user.todayDeployed += doc.deployed;
      user.todayBuilderTokens += doc.builderTokens;
      user.todayDeployedTokens += doc.deployedTokens;
    }

    totals.allTime.builder += doc.builder;
    totals.allTime.deployed += doc.deployed;
    totals.allTime.total += row;
    totals.allTime.builderTokens += doc.builderTokens;
    totals.allTime.deployedTokens += doc.deployedTokens;
    totals.allTime.totalTokens += rowTokens;
    active.allTime.add(doc.uid);
    if (week.has(doc.date)) {
      totals.week.builder += doc.builder;
      totals.week.deployed += doc.deployed;
      totals.week.total += row;
      totals.week.builderTokens += doc.builderTokens;
      totals.week.deployedTokens += doc.deployedTokens;
      totals.week.totalTokens += rowTokens;
      active.week.add(doc.uid);
    }
    if (doc.date === today) {
      totals.today.builder += doc.builder;
      totals.today.deployed += doc.deployed;
      totals.today.total += row;
      totals.today.builderTokens += doc.builderTokens;
      totals.today.deployedTokens += doc.deployedTokens;
      totals.today.totalTokens += rowTokens;
      active.today.add(doc.uid);
    }
  }

  const inWindow = (daily, window) => Object.entries(daily).reduce((sum, [date, n]) => sum + (window.has(date) ? n : 0), 0);
  const userList = [...users.values()]
    .map((user) => ({
      uid: user.uid,
      builder: user.builder,
      deployed: user.deployed,
      total: user.builder + user.deployed,
      builderTokens: user.builderTokens,
      deployedTokens: user.deployedTokens,
      totalTokens: user.builderTokens + user.deployedTokens,
      last7: inWindow(user.daily, week),
      last30: inWindow(user.daily, month),
      last7Tokens: inWindow(user.dailyTokens, week),
      last30Tokens: inWindow(user.dailyTokens, month),
      today: user.todayBuilder + user.todayDeployed,
      todayBuilder: user.todayBuilder,
      todayDeployed: user.todayDeployed,
      todayTokens: user.todayBuilderTokens + user.todayDeployedTokens,
      todayBuilderTokens: user.todayBuilderTokens,
      todayDeployedTokens: user.todayDeployedTokens,
      daily: user.daily,
      dailyTokens: user.dailyTokens,
    }))
    .sort((a, b) => b.last7 - a.last7 || b.total - a.total);

  return {
    generatedAt: new Date().toISOString(),
    project: firebaseProjectId(process.env),
    today,
    days: days30,
    totals,
    active: { today: active.today.size, week: active.week.size, allTime: active.allTime.size },
    users: userList,
  };
}

// The Account column shows emails instead of raw Firebase uids, resolved via
// the admin Identity Toolkit endpoint with the same OAuth identity. Resolved
// uids are cached for the server's lifetime; lookup failures back off for a
// few minutes rather than hammering the API on every auto-refresh.
const emailCache = new Map();
let emailLookupBackoffUntil = 0;

async function lookupEmails(uids) {
  const unknown = uids.filter((uid) => !emailCache.has(uid));
  if (unknown.length && Date.now() > emailLookupBackoffUntil) {
    try {
      const token = await getAccessToken();
      const url = `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId(process.env)}/accounts:lookup`;
      for (let i = 0; i < unknown.length; i += 100) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ localId: unknown.slice(i, i + 100) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        for (const account of data.users || []) {
          emailCache.set(account.localId, { email: account.email || '', name: account.displayName || '' });
        }
        for (const uid of unknown.slice(i, i + 100)) {
          if (!emailCache.has(uid)) emailCache.set(uid, { email: '', name: '' }); // deleted/unknown account
        }
      }
    } catch {
      emailLookupBackoffUntil = Date.now() + 5 * 60 * 1000;
    }
  }
  return emailCache;
}

async function usagePayload() {
  const docs = await fetchUsageDocs();
  const emails = await lookupEmails([...new Set(docs.map((doc) => doc.uid))]);
  return { ...aggregate(docs), emails: Object.fromEntries(emails) };
}

// --- Dashboard page -------------------------------------------------------

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AppBlips usage</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --edge: #262b36; --text: #e8eaf0;
    --muted: #8a93a6; --builder: #6ea8fe; --deployed: #34d399; --accent: #a78bfa;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--text);
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 20px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  .rangectx { font-size: 12px; color: var(--muted); }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--edge);
           border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
  button:hover { border-color: var(--muted); }
  button.active { border-color: var(--accent); }
  label.toggle input { accent-color: var(--accent); margin-right: 6px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--edge); border-radius: 12px; padding: 14px 16px; }
  .card .num { font-size: 26px; font-weight: 650; }
  .card .label { color: var(--muted); font-size: 12px; }
  .card .split { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .split .b { color: var(--builder); } .split .d { color: var(--deployed); }
  h2 { font-size: 14px; margin: 0 0 10px; color: var(--muted); font-weight: 600;
       text-transform: uppercase; letter-spacing: 0.06em; }
  section { margin-bottom: 28px; }
  table { border-collapse: collapse; width: 100%; background: var(--panel);
          border: 1px solid var(--edge); border-radius: 12px; overflow: hidden; }
  th, td { padding: 7px 12px; text-align: right; border-bottom: 1px solid var(--edge); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; background: #1c2029; }
  th:first-child, td:first-child { text-align: left; }
  tr:last-child td { border-bottom: none; }
  td.uid { font-family: ui-monospace, monospace; font-size: 12px; }
  td .bar { position: relative; display: inline-block; min-width: 2.6em; text-align: right; }
  td .bar::before { content: ""; position: absolute; right: 0; top: 3px; bottom: 3px;
          width: var(--w, 0%); border-radius: 3px; background: var(--builder); opacity: 0.3; }
  td.dep .bar::before { background: var(--deployed); }
  .zero { color: #4a5160; }
  strong { font-weight: 650; }
  #error { display: none; background: #3a1620; border: 1px solid #7d2c42; color: #ffb4c4;
           border-radius: 10px; padding: 10px 14px; margin-bottom: 20px; white-space: pre-wrap; }
  .empty { color: var(--muted); padding: 18px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>AppBlips usage</h1>
  <span class="meta" id="meta">loading…</span>
  <span class="spacer"></span>
  <span class="rangectx" id="range"></span>
  <button id="range7">7d</button>
  <button id="range30">30d</button>
  <label class="toggle"><input type="checkbox" id="auto" checked>auto</label>
  <button id="refresh">refresh</button>
</header>
<div id="error"></div>
<section>
  <h2>Today's leaders</h2>
  <div id="leaders"></div>
</section>
<section>
  <h2>Per-user history</h2>
  <div id="history"></div>
</section>
<section>
  <h2>Overall</h2>
  <div class="cards" id="cards"></div>
</section>
<script>
'use strict';
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortUid = (uid) => (uid.length > 12 ? uid.slice(0, 10) + '…' : uid);
const fmtDate = (d) => d.slice(5);
let range = 7;
let timer = null;
let EMAILS = {};

function accountCell(uid) {
  const info = EMAILS[uid] || {};
  const label = info.email || info.name || shortUid(uid);
  const title = info.email ? (info.name ? info.name + ' · ' : '') + uid : uid;
  return '<td class="uid" title="' + esc(title) + '">' + esc(label) + '</td>';
}

function barCell(value, max, cls) {
  if (!value) return '<td class="' + (cls || '') + ' zero">0</td>';
  const pct = Math.max(8, Math.round((value / max) * 100));
  return '<td class="' + (cls || '') + '"><span class="bar" style="--w:' + pct + '%"><i>' + value + '</i></span></td>';
}

const formatTokens = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;

function render(data) {
  EMAILS = data.emails || {};
  document.getElementById('meta').textContent =
    data.project + ' · updated ' + new Date(data.generatedAt).toLocaleTimeString();

  const cards = [
    ['Activity today', data.totals.today],
    ['Activity · 7 days', data.totals.week],
    ['Activity · all time', data.totals.allTime],
  ].map(([label, t]) =>
    '<div class="card"><div class="label">' + label + '</div><div class="num">' + t.total + '</div>' +
    '<div class="split"><span class="b">' + t.builder + ' builder</span> · <span class="d">' + t.deployed + ' deployed</span></div>' +
    '<div class="split" style="margin-top:4px"><span class="b">' + formatTokens(t.builderTokens) + ' tok</span> · <span class="d">' + formatTokens(t.deployedTokens) + ' tok</span></div></div>'
  ).join('') +
  '<div class="card"><div class="label">Active accounts</div><div class="num">' + data.active.today +
  ' <span style="font-size:13px;color:var(--muted)">today</span></div>' +
  '<div class="split">' + data.active.week + ' this week · ' + data.active.allTime + ' all time</div></div>';
  document.getElementById('cards').innerHTML = cards;

  const leaders = data.users.filter((u) => u.today > 0).sort((a, b) => b.today - a.today);
  const leaderMax = leaders.length ? leaders[0].today : 1;
  document.getElementById('leaders').innerHTML = !leaders.length
    ? '<table><tr><td class="empty">No recorded activity today (UTC ' + data.today + ').</td></tr></table>'
    : '<table><tr><th>Account</th><th>Builder</th><th>Deployed</th><th>Tokens</th><th>Total reqs</th></tr>' +
      leaders.map((u) =>
        '<tr>' + accountCell(u.uid) +
        barCell(u.todayBuilder, leaderMax) +
        barCell(u.todayDeployed, leaderMax, 'dep') +
        '<td>' + formatTokens(u.todayTokens) + '</td>' +
        '<td><strong>' + u.today + '</strong></td></tr>').join('') +
      '</table>';

  const days = data.days.slice(-range);
  const shown = data.users.filter((u) => (range === 7 ? u.last7 > 0 : u.total > 0));
  const histMax = Math.max(1, ...shown.flatMap((u) => days.map((d) => u.daily[d] || 0)));
  document.getElementById('range').textContent =
    'last ' + range + ' days · ' + fmtDate(days[0]) + ' → ' + fmtDate(days[days.length - 1]) + ' UTC';
  document.getElementById('history').innerHTML = !shown.length
    ? '<table><tr><td class="empty">No recorded activity in this window.</td></tr></table>'
    : '<table><tr><th>Account</th>' + days.map((d) => '<th title="' + d + '">' + fmtDate(d) + '</th>').join('') +
      '<th>' + range + 'd</th><th>Tokens</th><th>All time reqs</th></tr>' +
      shown.map((u) =>
        '<tr>' + accountCell(u.uid) +
        days.map((d) => barCell(u.daily[d] || 0, histMax)).join('') +
        '<td><strong>' + u['last' + range] + '</strong></td>' +
        '<td>' + formatTokens(range === 7 ? u.last7Tokens : u.last30Tokens) + '</td>' +
        '<td>' + u.total + '</td></tr>').join('') +
      '</table>';

  document.getElementById('range7').className = range === 7 ? 'active' : '';
  document.getElementById('range30').className = range === 30 ? 'active' : '';
}

function showBanner(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.style.display = message ? 'block' : 'none';
}

async function load() {
  try {
    const res = await fetch('/api/usage');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    showBanner('');
    render(data);
  } catch (err) {
    showBanner('Failed to load usage: ' + err.message);
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  if (document.getElementById('auto').checked) timer = setInterval(load, 30000);
}
document.getElementById('auto').addEventListener('change', schedule);
document.getElementById('refresh').addEventListener('click', load);
document.getElementById('range7').addEventListener('click', () => { range = 7; load(); });
document.getElementById('range30').addEventListener('click', () => { range = 30; load(); });
schedule();
load();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(await usagePayload()));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
});

const portArg = process.argv.indexOf('--port');
const port = portArg > -1
  ? parseInt(process.argv[portArg + 1], 10)
  : parseInt(process.env.USAGE_DASHBOARD_PORT, 10) || 5178;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use -- is another dashboard instance still running? Try: --port ${port + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Usage dashboard → http://127.0.0.1:${port}  (Ctrl+C to stop)`);
});
