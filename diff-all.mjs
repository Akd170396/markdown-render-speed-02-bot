// Print compact first-diff info for every failing case (or one case in full).
import { readFileSync } from 'node:fs';
import { parse } from './parse.js';

const KIT = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}/practice/reference/expected.json`, 'utf8'));
const expById = new Map(expected.cases.map((c) => [c.id, c.html]));
const mdById = new Map(cases.map((c) => [c.id, c.markdown]));

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

const only = process.argv[2];
const ids = only ? [only] : cases.map((c) => c.id);
for (const id of ids) {
  const md = mdById.get(id);
  const want = expById.get(id);
  let got;
  try { got = parse(md); } catch (e) { console.log(`${id}: THREW ${e}`); continue; }
  if (got === want) { if (only) console.log(`${id}: PASS`); continue; }
  const d = firstDiff(got, want);
  console.log(`=== ${id} diff@${d} gotLen=${got.length} wantLen=${want.length}`);
  console.log(`  md:   ${JSON.stringify(md.slice(0, 400))}`);
  console.log(`  got:  ${JSON.stringify(got.slice(Math.max(0, d - 80), d + 160))}`);
  console.log(`  want: ${JSON.stringify(want.slice(Math.max(0, d - 80), d + 160))}`);
}
