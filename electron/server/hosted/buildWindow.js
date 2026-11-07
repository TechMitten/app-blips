// The build cooldown (plans.js windowBuilds / windowHours): at most N builds
// in a window that starts at the first build and lasts the plan's hours.
// Shared by the Node SQLite store and the Worker's D1 store so both count the
// same way. Times are epoch milliseconds.
//
// One UPDATE both checks and counts, so two builds sent at once can't both
// slip past the limit. SQLite evaluates every SET expression against the old
// row, so both CASEs see the window as it was before this build.
//   ?1 user_id  ?2 cutoff (now - window)  ?3 now  ?4 limit
export const TAKE_BUILD_SQL = `
  update accounts set
    build_window_start = case when build_window_start is null or build_window_start <= ?2 then ?3 else build_window_start end,
    build_window_count = case when build_window_start is null or build_window_start <= ?2 then 1 else build_window_count + 1 end
  where user_id = ?1
    and (build_window_start is null or build_window_start <= ?2 or build_window_count < ?4)
  returning build_window_start as start, build_window_count as count
`;

// Gives a build back when the provider rejected it outright (nothing built).
export const RELEASE_BUILD_SQL = `
  update accounts set build_window_count = build_window_count - 1
  where user_id = ? and build_window_count > 0
`;

export const WINDOW_START_SQL = 'select build_window_start as start from accounts where user_id = ?';

// Older stores get the columns added in place (Node store; D1 has a migration).
export const BUILD_WINDOW_COLUMNS = {
  build_window_start: 'alter table accounts add column build_window_start integer',
  build_window_count: 'alter table accounts add column build_window_count integer not null default 0',
};

// { allowed: true } or { allowed: false, resetAt } from the UPDATE's returned
// row (none when the limit was hit) and the window's start.
export const windowResult = (taken, start, windowMs) => (taken
  ? { allowed: true }
  : { allowed: false, resetAt: Number(start || 0) + windowMs });
