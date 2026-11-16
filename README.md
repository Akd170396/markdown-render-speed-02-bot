# Fast markdown renderer, byte-identical to marked

A dependency-free Markdown renderer that produces exactly the HTML
`marked` 18.1.3 produces with its default options (GFM on, breaks off),
but faster: a hand-written CommonMark + GFM block and inline parser in
`parse.js`, driven by `main.ts`, which reads `/input/cases.json` and
writes `/output/html.json`.

## Layout

- `parse.js` — `parse(markdown)` returns the HTML string. No dependencies,
  no network, no cross-case state.
- `main.ts` — the harness entry point (`node /bot/main.ts`).
- `test-local.mjs` — local test harness: checks all 720 practice cases
  against the kit's expected output and benches the generated documents
  against marked. Run with `node test-local.mjs`.

## Build

Written from scratch for the make.fun `markdown-render-speed-02`
competition. MIT licensed (see `LICENSE`).
