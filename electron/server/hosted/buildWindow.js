// The usage cooldown (plans.js windowBuilds / windowHours): at most N uses
// in a window that starts at the first use and lasts the plan's hours. (The
// code and columns say "build"; the app calls it "usage".)
// Shared by the Node SQLite store and the Worker's D1 store so both count the
// same way. Times are epoch milliseconds.
//
// Usage is counted per user action, not per AI request: one prompt makes
// several requests (opening reply, the build itself, the summary, tool turns,
// repairs), and the client tags all of them with the same usage id. Only the
// first request with a new id counts; the rest ride on it. A request with no
// id counts on its own, so leaving the id out never makes anything free.
// Only the latest id is remembered, so two actions interleaving (A, B, A)
// count A twice; that over-counts rather than under-counts.
//
// One UPDATE both checks and counts, so two requests sent at once can't both
// slip past the limit or both count the same id. SQLite evaluates every SET
// expression against the old row, so each CASE sees the row as it was before
// this request. A repeat of the latest id is let through even at the limit,
// so an action that started inside the limit can finish; if the window has
// ended meanwhile, the new window starts with nothing used.
//
// The usage id, Ask mode and automatic repairs all come from the client, so
// none of them may make usage unbounded:
//  - an id only rides for ACTION_MAX_MS after it was counted; reused later,
//    it counts again (otherwise one fixed id would be free forever);
//  - every request, counted or free, also counts toward a request ceiling
//    per window (REQUESTS_PER_USE per allowed use), which nothing bypasses.
// build_window_counted records whether this request was the one that counted,
// so a rejected follow-up request doesn't give back its action's usage.
//   ?1 user_id  ?2 cutoff (now - window)  ?3 now  ?4 use limit
//   ?5 usage id or null  ?6 request ceiling  ?7 1 = counts as a use, 0 = free
//   (Ask mode, automatic repair)  ?8 cutoff for repeats (now - ACTION_MAX_MS)
export const ACTION_MAX_MS = 30 * 60 * 1000;
export const REQUESTS_PER_USE = 40;
const EXPIRED = 'build_window_start is null or build_window_start <= ?2';
// coalesce: a null last id or time must read as "not a repeat", not as null.
const REPEAT = '?7 = 1 and ?5 is not null and coalesce(build_window_last_id = ?5 and build_window_last_at > ?8, 0)';
const NEW_USE = `?7 = 1 and not (${REPEAT})`;
export const TAKE_BUILD_SQL = `
  update accounts set
    build_window_start = case when ${EXPIRED} then ?3 else build_window_start end,
    build_window_count = case
      when ${NEW_USE} then case when ${EXPIRED} then 1 else build_window_count + 1 end
      else case when ${EXPIRED} then 0 else build_window_count end end,
    build_window_requests = case when ${EXPIRED} then 1 else build_window_requests + 1 end,
    build_window_counted = case when ${NEW_USE} then 1 else 0 end,
    build_window_last_id = case when ?7 = 1 then ?5 else build_window_last_id end,
    build_window_last_at = case when ${NEW_USE} then ?3 else build_window_last_at end
  where user_id = ?1
    and ((${EXPIRED}) or build_window_requests < ?6)
    and ((${EXPIRED}) or not (${NEW_USE}) or build_window_count < ?4)
  returning build_window_start as start, build_window_count as count, build_window_counted as counted
`;

// Gives an action's usage back when the provider rejected the request that
// counted it (nothing built). Forgetting the id makes a retry of the same
// action count again, so it's still counted once in the end. Another action
// may have become the latest since, so the id is only cleared if it's ours.
// Only the window the use was counted in is touched (a window that started
// since has nothing of it to give back). Requests are never given back: the
// ceiling bounds what was sent, not what was built.
//   ?1 user_id  ?2 usage id or null  ?3 that window's start, or null for any
export const RELEASE_BUILD_SQL = `
  update accounts set
    build_window_count = build_window_count - 1,
    build_window_last_id = case when build_window_last_id is ?2 then null else build_window_last_id end
  where user_id = ?1 and build_window_count > 0 and (?3 is null or build_window_start = ?3)
`;

export const WINDOW_START_SQL = 'select build_window_start as start, build_window_requests as requests from accounts where user_id = ?';

// Older stores get the columns added in place (Node store; D1 has a migration).
export const BUILD_WINDOW_COLUMNS = {
  build_window_start: 'alter table accounts add column build_window_start integer',
  build_window_count: 'alter table accounts add column build_window_count integer not null default 0',
  build_window_last_id: 'alter table accounts add column build_window_last_id text',
  build_window_counted: 'alter table accounts add column build_window_counted integer not null default 0',
  build_window_requests: 'alter table accounts add column build_window_requests integer not null default 0',
  build_window_last_at: 'alter table accounts add column build_window_last_at integer',
};

// The bound values for TAKE_BUILD_SQL, in order, for both stores.
export const takeBuildParams = (userId, { limit, requestLimit, windowMs, usageId = null, counts = true, at = Date.now() }) => [
  userId, at - windowMs, at, limit, usageId ?? null,
  requestLimit ?? limit * REQUESTS_PER_USE, counts ? 1 : 0, at - ACTION_MAX_MS,
];

// A usage id from the request body: the client's random per-action id, or
// null when it's missing or malformed (the request then counts on its own).
export const usageIdOf = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null);

// { allowed: true, counted, start } or { allowed: false, resetAt, reason }
// from the UPDATE's returned row (none when a limit was hit) and, then, the
// row read back. `counted` is false for a repeat of the latest usage id and
// for free requests; `start` is the window it was counted in (for release).
// `reason` is 'requests' when the request ceiling was hit, else 'uses'.
export const windowResult = (taken, current, windowMs, requestLimit) => (taken
  ? { allowed: true, counted: Number(taken.counted) === 1, start: Number(taken.start) }
  : {
    allowed: false,
    resetAt: Number(current?.start || 0) + windowMs,
    reason: requestLimit != null && Number(current?.requests) >= requestLimit ? 'requests' : 'uses',
  });

// How much of the window a user has used, for Settings → Account: uses
// counted so far and when the window ends (null when none is running, so the
// next use starts a fresh one). Same "still running" test as TAKE_BUILD_SQL.
export function windowUsage(account, { limit, windowMs }, at = Date.now()) {
  const start = Number(account?.build_window_start) || 0;
  const running = start > at - windowMs;
  return {
    used: running ? Math.min(Number(account.build_window_count) || 0, limit) : 0,
    limit,
    resetAt: running ? new Date(start + windowMs).toISOString() : null,
  };
}
