// Local test helper: compare parse.js against marked 18.1.3 (vendored in kit)
// on all 720 practice cases. Usage:
//   node test-local.mjs            -> summary + failing ids
//   node test-local.mjs <id>       -> full diff for one case
//   node test-local.mjs --bench    -> timing parse.js vs marked
import { readFileSync } from 'node:fs';
import { marked } from '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/baselines/vendor/marked/marked.esm.js';
import { parse } from './parse.js';

const KIT = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}/practice/reference/expected.json`, 'utf8'));
const expById = new Map(expected.cases.map((c) => [c.id, c.html]));

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function showDiff(id, md, got, want) {
  const d = firstDiff(got, want);
  console.log(`=== ${id} (md ${md.length} chars, got ${got.length}, want ${want.length}) first diff at ${d}`);
  console.log('--- markdown (first 800 chars) ---');
  console.log(JSON.stringify(md.slice(0, 800)));
  if (d >= 0) {
    console.log('--- got   @', d, '---');
    console.log(JSON.stringify(got.slice(Math.max(0, d - 120), d + 200)));
    console.log('--- want  @', d, '---');
    console.log(JSON.stringify(want.slice(Math.max(0, d - 120), d + 200)));
  }
}

const arg = process.argv[2];
if (arg === '--bench') {
  // warm up
  for (const c of cases) parse(c.markdown);
  const t0 = process.hrtime.bigint();
  for (const c of cases) parse(c.markdown);
  const t1 = process.hrtime.bigint();
  for (const c of cases) marked.parse(c.markdown);
  const t2 = process.hrtime.bigint();
  const ms = (a, b) => Number(b - a) / 1e6;
  console.log(`parse.js total: ${ms(t0, t1).toFixed(1)} ms`);
  console.log(`marked  total:  ${ms(t1, t2).toFixed(1)} ms`);
  // docs only
  const docs = cases.slice(680);
  let a = process.hrtime.bigint();
  for (const c of docs) parse(c.markdown);
  let b = process.hrtime.bigint();
  for (const c of docs) marked.parse(c.markdown);
  let cc = process.hrtime.bigint();
  console.log(`docs parse.js: ${ms(a, b).toFixed(1)} ms, marked: ${ms(b, cc).toFixed(1)} ms`);
  const spec = cases.slice(0, 680);
  a = process.hrtime.bigint();
  for (const c of spec) parse(c.markdown);
  b = process.hrtime.bigint();
  for (const c of spec) marked.parse(c.markdown);
  cc = process.hrtime.bigint();
  console.log(`spec parse.js: ${ms(a, b).toFixed(1)} ms, marked: ${ms(b, cc).toFixed(1)} ms`);
  process.exit(0);
}

let pass = 0;
const fail = [];
for (const c of cases) {
  let got;
  try {
    got = parse(c.markdown);
  } catch (e) {
    fail.push({ id: c.id, err: String(e) });
    continue;
  }
  const want = expById.get(c.id);
  // sanity: expected should equal marked
  if (got === want) pass++;
  else fail.push({ id: c.id, got, want, md: c.markdown });
}
console.log(`PASS ${pass}/720  FAIL ${fail.length}/720`);
const specFail = fail.filter((f) => !f.id.startsWith('doc-'));
const docFail = fail.filter((f) => f.id.startsWith('doc-'));
console.log(`spec fails: ${specFail.length}, doc fails: ${docFail.length}`);
console.log('failing spec ids:', specFail.map((f) => f.id).join(' '));
console.log('failing doc ids:', docFail.map((f) => f.id).join(' '));
for (const f of fail) if (f.err) console.log(f.id, 'THREW:', f.err);

if (arg && arg !== '--bench') {
  const f = fail.find((x) => x.id === arg);
  if (!f) { console.log(arg, 'passes or not found'); process.exit(0); }
  if (f.err) { console.log(arg, 'threw', f.err); process.exit(0); }
  showDiff(f.id, f.md, f.got, f.want);
} else if (fail.length && fail.length <= 45) {
  for (const f of fail) {
    if (f.err) continue;
    const d = firstDiff(f.got, f.want);
    console.log(`${f.id}: diff@${d} got[${f.got.length}] want[${f.want.length}] gotCtx=${JSON.stringify(f.got.slice(Math.max(0, d - 40), d + 80))}`);
  }
}
