import { readFileSync } from 'node:fs';
import { parse } from './parse.js';
import { marked } from '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/baselines/vendor/marked/marked.esm.js';

const kit = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(kit + '/practice/input/cases.json', 'utf8'));
const expected = JSON.parse(readFileSync(kit + '/practice/reference/expected.json', 'utf8')).cases;

const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';
const bench = process.argv.includes('--bench');

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

let pass = 0, fail = 0;
const failed = [];
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  if (filter && !c.id.startsWith(filter) && c.id !== filter) continue;
  let got;
  try { got = parse(c.markdown); } catch (e) { got = 'THREW: ' + e.message; }
  const want = expected[i].html;
  if (got === want) { pass++; continue; }
  fail++;
  failed.push(c.id);
  const d = firstDiff(got, want);
  console.log('FAIL ' + c.id + ' at char ' + d);
  console.log('  in : ' + JSON.stringify(c.markdown).slice(0, 400));
  console.log('  got: ' + JSON.stringify(got.slice(Math.max(0, d - 60), d + 120)));
  console.log('  exp: ' + JSON.stringify(want.slice(Math.max(0, d - 60), d + 120)));
}
console.log('PASS ' + pass + '/' + (pass + fail) + (failed.length ? '  failed: ' + failed.join(',') : ''));

if (bench) {
  const docs = cases.slice(680);
  const t = (fn) => {
    const start = performance.now();
    for (let r = 0; r < 3; r++) for (const c of docs) fn(c.markdown);
    return (performance.now() - start) / 3;
  };
  const mine = t((s) => parse(s));
  const ref = t((s) => marked.parse(s));
  console.log('BENCH docs parse.js ' + mine.toFixed(1) + ' ms vs marked ' + ref.toFixed(1) + ' ms (x' + (ref / mine).toFixed(2) + ')');
}
