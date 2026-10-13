// `npm run check`, step one: type-check the JavaScript with TypeScript, but
// fail only on errors that are always real bugs. Full checking of plain JS
// also reports inference noise (a `{}` default reads as "property doesn't
// exist"), which would make the check fail on working code. A file can opt
// into stricter checking later by fixing its own noise; this list stays small.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const BUG_CODES = new Set([
  2304, // Cannot find name (typo, missing import)
  2305, // Module has no exported member
  2307, // Cannot find module (wrong path, missing file or package)
  2552, // Cannot find name, did you mean ...
  2554, // Wrong number of arguments
  2614, // Module has no exported member (did you mean default import?)
  2724, // Module has no exported member, did you mean ...
]);
// TS1xxx are syntax errors.
const isBug = (code) => code < 2000 || BUG_CODES.has(code);

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.check.json', '--pretty', 'false'], { encoding: 'utf8' });
if (run.error) throw run.error;

const lines = `${run.stdout}${run.stderr}`.split('\n');
const errors = lines.filter((line) => {
  const match = line.match(/error TS(\d+):/);
  return match && isBug(Number(match[1]));
});
// Messages can continue on indented lines; keep those with their error.
const report = [];
for (let i = 0; i < lines.length; i++) {
  if (!errors.includes(lines[i])) continue;
  report.push(lines[i]);
  while (lines[i + 1]?.startsWith(' ')) report.push(lines[++i]);
}

if (errors.length) {
  console.error(report.join('\n'));
  console.error(`\nType check failed: ${errors.length} error${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('Type check passed.');
