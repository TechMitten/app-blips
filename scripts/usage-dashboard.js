// Operator dashboard for the per-account usage counters written by
// functions/_lib/usageTracking.js.
//
//   npm run usage            → http://127.0.0.1:5178  (Ctrl+C to stop)
//
// Reads usage and account data as the Firebase service account. Set
// FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT before starting it. The
// dashboard binds to loopback and never exposes that key to the served page.
import http from 'node:http';
import { serviceAccountConfigured, firebaseProjectId, runQuery, listAuthUsers } from '../functions/_lib/firebaseServer.js';
import { PLANS, PAID_PLAN_IDS } from '../functions/_lib/plans.js';

// Stripe's cut of each monthly charge (card 2.9% + 30c, Billing 0.7%), for
// the margin estimate. A rough figure: international cards cost more.
const stripeFee = (price) => price * 0.036 + 0.3;

async function fetchUsageDocs() {
  if (!serviceAccountConfigured(process.env)) throw new Error('FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT are required.');
  return (await runQuery(process.env, 'usage')).map(({ data: row }) => ({
      uid: row.user_id || '(unknown)',
      date: row.date || '',
      builder: Number(row.builder_requests) || 0,
      deployed: Number(row.deployed_requests) || 0,
      builderTokens: Number(row.builder_tokens) || 0,
      deployedTokens: Number(row.deployed_tokens) || 0,
      costMicros: Number(row.cost_micros) || 0,
      cachedTokens: Number(row.cached_tokens) || 0,
    }))
    .filter((doc) => doc.date);
}

// uid -> paid plan id, for accounts whose subscription currently grants one
// (same rule as billing.js: past_due keeps the plan while Stripe retries).
async function fetchPaidPlans() {
  return new Map((await runQuery(process.env, 'subscriptions'))
    .map(({ id, data }) => [id, data])
    .filter(([, row]) => PAID_PLAN_IDS.includes(row.plan) && ['active', 'trialing', 'past_due'].includes(row.status))
    .map(([uid, row]) => [uid, row.plan]));
}

const utcOffsetDay = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const lastNDates = (n) => Array.from({ length: n }, (_, i) => utcOffsetDay(n - 1 - i));

function aggregate(docs, paidPlans = new Map()) {
  const today = utcOffsetDay(0);
  const days30 = lastNDates(30);
  const week = new Set(days30.slice(-7));
  const month = new Set(days30);

  const users = new Map();
  const blank = () => ({ builder: 0, deployed: 0, total: 0, builderTokens: 0, deployedTokens: 0, totalTokens: 0, costMicros: 0, cachedTokens: 0 });
  const totals = { today: blank(), week: blank(), month: blank(), allTime: blank() };
  const active = { today: new Set(), week: new Set(), allTime: new Set() };

  for (const doc of docs) {
    const row = doc.builder + doc.deployed;
    const rowTokens = doc.builderTokens + doc.deployedTokens;
    let user = users.get(doc.uid);
    if (!user) {
      user = { uid: doc.uid, builder: 0, deployed: 0, builderTokens: 0, deployedTokens: 0, costMicros: 0, last30CostMicros: 0, daily: {}, dailyTokens: {}, todayBuilder: 0, todayDeployed: 0, todayBuilderTokens: 0, todayDeployedTokens: 0 };
      users.set(doc.uid, user);
    }
    user.builder += doc.builder;
    user.deployed += doc.deployed;
    user.builderTokens += doc.builderTokens;
    user.deployedTokens += doc.deployedTokens;
    user.costMicros += doc.costMicros;
    if (month.has(doc.date)) user.last30CostMicros += doc.costMicros;
    user.daily[doc.date] = (user.daily[doc.date] || 0) + row;
    user.dailyTokens[doc.date] = (user.dailyTokens[doc.date] || 0) + rowTokens;
    if (doc.date === today) {
      user.todayBuilder += doc.builder;
      user.todayDeployed += doc.deployed;
      user.todayBuilderTokens += doc.builderTokens;
      user.todayDeployedTokens += doc.deployedTokens;
    }

    const add = (t) => {
      t.builder += doc.builder;
      t.deployed += doc.deployed;
      t.total += row;
      t.builderTokens += doc.builderTokens;
      t.deployedTokens += doc.deployedTokens;
      t.totalTokens += rowTokens;
      t.costMicros += doc.costMicros;
      t.cachedTokens += doc.cachedTokens;
    };
    add(totals.allTime);
    active.allTime.add(doc.uid);
    if (month.has(doc.date)) add(totals.month);
    if (week.has(doc.date)) {
      add(totals.week);
      active.week.add(doc.uid);
    }
    if (doc.date === today) {
      add(totals.today);
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
      costMicros: user.costMicros,
      last30CostMicros: user.last30CostMicros,
      plan: paidPlans.get(user.uid) || 'free',
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

  // Last 30 days, by plan: what each group cost us against what it paid.
  // Paid accounts count even with no usage (they still pay); free accounts
  // only once they've used something, since sign-ups who never build cost nothing.
  const economics = ['free', ...PAID_PLAN_IDS].map((planId) => {
    const plan = PLANS[planId];
    const accounts = planId === 'free'
      ? userList.filter((u) => u.plan === 'free' && u.last30 > 0).length
      : [...paidPlans.values()].filter((id) => id === planId).length;
    const cost = userList.filter((u) => u.plan === planId).reduce((sum, u) => sum + u.last30CostMicros, 0) / 1e6;
    const revenue = accounts * plan.price;
    const fees = plan.price ? accounts * stripeFee(plan.price) : 0;
    return { plan: planId, label: plan.label, price: plan.price, accounts, cost, revenue, fees, margin: revenue - fees - cost };
  });

  return {
    generatedAt: new Date().toISOString(),
    project: firebaseProjectId(process.env),
    today,
    days: days30,
    totals,
    economics,
    active: { today: active.today.size, week: active.week.size, allTime: active.allTime.size },
    users: userList,
  };
}

// The Account column shows emails instead of raw user ids, resolved via
// Firebase Auth (accounts:batchGet). Resolved uids are cached for the
// server's lifetime; lookup failures back off for a few minutes rather than
// hammering the API on every auto-refresh.
const emailCache = new Map();
let emailLookupBackoffUntil = 0;

async function lookupEmails(uids) {
  const unknown = uids.filter((uid) => !emailCache.has(uid));
  if (unknown.length && Date.now() > emailLookupBackoffUntil) {
    try {
      for (const account of await listAuthUsers(process.env)) {
        emailCache.set(account.localId, { email: account.email || '', name: account.displayName || '' });
      }
      for (const uid of unknown) {
        if (!emailCache.has(uid)) emailCache.set(uid, { email: '', name: '' }); // deleted/unknown account
      }
    } catch {
      emailLookupBackoffUntil = Date.now() + 5 * 60 * 1000;
    }
  }
  return emailCache;
}

async function usagePayload() {
  const [docs, paidPlans] = await Promise.all([fetchUsageDocs(), fetchPaidPlans()]);
  const emails = await lookupEmails([...new Set(docs.map((doc) => doc.uid))]);
  return { ...aggregate(docs, paidPlans), emails: Object.fromEntries(emails) };
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
  <h2>Costs · last 30 days</h2>
  <div class="cards" id="costCards"></div>
  <div id="economics" style="margin-top:12px"></div>
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

const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(Math.abs(n) < 10 ? 2 : 0);
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

  const spend = (t) => t.costMicros / 1e6;
  const cacheShare = (t) => t.totalTokens ? Math.round((t.cachedTokens / t.totalTokens) * 100) + '% cached' : 'no tokens';
  const perMillion = (t) => t.totalTokens ? money(spend(t) / (t.totalTokens / 1e6)) + ' per 1M tok' : '';
  document.getElementById('costCards').innerHTML = [
    ['Spend today', data.totals.today],
    ['Spend · 7 days', data.totals.week],
    ['Spend · 30 days', data.totals.month],
  ].map(([label, t]) =>
    '<div class="card"><div class="label">' + label + '</div><div class="num">' + money(spend(t)) + '</div>' +
    '<div class="split">' + perMillion(t) + '</div><div class="split">' + cacheShare(t) + '</div></div>'
  ).join('');

  const econ = data.economics || [];
  const net = econ.reduce((sum, row) => sum + row.margin, 0);
  document.getElementById('economics').innerHTML =
    '<table><tr><th>Plan</th><th>Accounts</th><th>Revenue</th><th>Stripe fees</th><th>Model cost</th><th>Cost / account</th><th>Margin</th></tr>' +
    econ.map((row) =>
      '<tr><td>' + esc(row.label) + (row.price ? ' ($' + row.price + ')' : ' (active)') + '</td>' +
      '<td>' + row.accounts + '</td><td>' + money(row.revenue) + '</td><td>' + money(row.fees) + '</td>' +
      '<td>' + money(row.cost) + '</td><td>' + (row.accounts ? money(row.cost / row.accounts) : '–') + '</td>' +
      '<td><strong>' + money(row.margin) + '</strong></td></tr>').join('') +
    '<tr><td><strong>Net before fixed costs</strong></td><td colspan="5"></td><td><strong>' + money(net) + '</strong></td></tr></table>' +
    '<div class="meta" style="margin-top:6px">Model cost is what the provider reported (OpenRouter usage.cost); ' +
    'days before cost tracking show $0. Revenue assumes every paid account pays the current monthly price.</div>';

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
      // Built before writeHead so a failed query still gets the 502 below.
      const body = JSON.stringify(await usagePayload());
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
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
