// Local test harness (not part of the graded entry): runs parse.js over the
// practice set and compares with the kit's expected.json, then benches the
// 40 generated documents against marked.
import { readFileSync } from 'node:fs';
import { parse } from './parse.js';
import { marked } from '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/baselines/vendor/marked/marked.esm.js';

const KIT = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}/practice/reference/expected.json`, 'utf8'));
const want = new Map(expected.cases.map((c) => [c.id, c.html]));
const groups = new Map(expected.groups.map((g) => [g.key, g.title]));

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
  return n;
}

function snippet(s, at, w = 90) {
  const lo = Math.max(0, at - 40);
  const hi = Math.min(s.length, at + w);
  return JSON.stringify(s.slice(lo, hi));
}

const only = process.argv[2];
let pass = 0;
const failed = [];
for (const c of cases) {
  if (only && c.id !== only) continue;
  let got;
  try {
    got = parse(c.markdown);
  } catch (e) {
    got = `<<THREW ${e.message}>>`;
  }
  const w = want.get(c.id);
  if (got === w) {
    pass++;
  } else {
    const at = firstDiff(String(got), w);
    failed.push({ id: c.id, at, got: String(got), want: w, md: c.markdown });
  }
}

const total = only ? 1 : cases.length;
console.log(`PASS ${pass}/${total}`);
if (failed.length) {
  const byGroup = new Map();
  for (const f of failed) {
    const g = expected.cases.find((c) => c.id === f.id)?.group ?? '?';
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }
  console.log('failures by group:');
  for (const [g, n] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g} (${groups.get(g) ?? ''}): ${n}`);
  }
  const show = failed.slice(0, 12);
  for (const f of show) {
    console.log(`--- ${f.id} first diff at ${f.at} (got ${f.got.length} chars, want ${f.want.length})`);
    console.log(`  md:   ${JSON.stringify(f.md).slice(0, 400)}`);
    console.log(`  got:  ${snippet(f.got, f.at)}`);
    console.log(`  want: ${snippet(f.want, f.at)}`);
  }
  if (failed.length > show.length) console.log(`... and ${failed.length - show.length} more failures`);
}

if (!only) {
  const docs = cases.filter((c) => c.id.startsWith('doc-'));
  const bench = (fn, n) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) for (const d of docs) fn(d.markdown);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const tMine = bench(parse, 3);
  const tMarked = bench((md) => marked.parse(md), 3);
  console.log(`bench docs x3: mine ${tMine.toFixed(1)} ms, marked ${tMarked.toFixed(1)} ms, ratio ${(tMarked / tMine).toFixed(2)}x`);
  const t0 = process.hrtime.bigint();
  for (const c of cases) parse(c.markdown);
  const t1 = process.hrtime.bigint();
  for (const c of cases) marked.parse(c.markdown);
  const t2 = process.hrtime.bigint();
  console.log(`bench full set x1: mine ${Number(t1 - t0) / 1e6} ms, marked ${Number(t2 - t1) / 1e6} ms`);
}
