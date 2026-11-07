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
// this request. A repeat of the latest id is always let through, even at the
// limit, so an action that started inside the limit can finish; if the window
// has ended meanwhile, the new window starts with nothing used.
// build_window_counted records whether this request was the one that counted,
// so a rejected follow-up request doesn't give back its action's usage.
//   ?1 user_id  ?2 cutoff (now - window)  ?3 now  ?4 limit  ?5 usage id or null
const EXPIRED = 'build_window_start is null or build_window_start <= ?2';
const REPEAT = '?5 is not null and build_window_last_id = ?5';
export const TAKE_BUILD_SQL = `
  update accounts set
    build_window_start = case when ${EXPIRED} then ?3 else build_window_start end,
    build_window_count = case
      when ${REPEAT} then case when ${EXPIRED} then 0 else build_window_count end
      when ${EXPIRED} then 1
      else build_window_count + 1 end,
    build_window_counted = case when ${REPEAT} then 0 else 1 end,
    build_window_last_id = ?5
  where user_id = ?1
    and ((${EXPIRED}) or (${REPEAT}) or build_window_count < ?4)
  returning build_window_start as start, build_window_count as count, build_window_counted as counted
`;

// Gives an action's usage back when the provider rejected the request that
// counted it (nothing built). Forgetting the id makes a retry of the same
// action count again, so it's still counted once in the end. Another action
// may have become the latest since, so the id is only cleared if it's ours.
//   ?1 user_id  ?2 usage id or null
export const RELEASE_BUILD_SQL = `
  update accounts set
    build_window_count = build_window_count - 1,
    build_window_last_id = case when build_window_last_id is ?2 then null else build_window_last_id end
  where user_id = ?1 and build_window_count > 0
`;

export const WINDOW_START_SQL = 'select build_window_start as start from accounts where user_id = ?';

// Older stores get the columns added in place (Node store; D1 has a migration).
export const BUILD_WINDOW_COLUMNS = {
  build_window_start: 'alter table accounts add column build_window_start integer',
  build_window_count: 'alter table accounts add column build_window_count integer not null default 0',
  build_window_last_id: 'alter table accounts add column build_window_last_id text',
  build_window_counted: 'alter table accounts add column build_window_counted integer not null default 0',
};

// A usage id from the request body: the client's random per-action id, or
// null when it's missing or malformed (the request then counts on its own).
export const usageIdOf = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null);

// { allowed: true } or { allowed: false, resetAt } from the UPDATE's returned
// row (none when the limit was hit) and the window's start. `counted` is
// false for a repeat of the latest usage id.
export const windowResult = (taken, start, windowMs) => (taken
  ? { allowed: true, counted: Number(taken.counted) === 1 }
  : { allowed: false, resetAt: Number(start || 0) + windowMs });

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
