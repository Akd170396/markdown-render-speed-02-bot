// parse.js — a fast CommonMark 0.31.2 + GFM 0.29 renderer whose parse()
// returns exactly the HTML marked 18.1.3 renders with its default options
// (gfm on, breaks off, pedantic off, async off).
//
// Written from the CommonMark and GFM specifications and the reference
// renderer's observed behaviour on the practice set. The renderer works in
// two phases: block structure first (link reference definitions are
// collected for the whole document before any inline rendering, so a
// definition after its use still resolves), then inline rendering.
//
// Design notes (speed): blocks render straight to strings; inline text is
// scanned in bulk runs and only re-scanned where markup can start; emphasis
// is resolved with a delimiter stack over a small token list, so plain
// paragraphs never pay for delimiter bookkeeping.

// ---------- small helpers ----------

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Escape < > " ' always; escape & only when it does not start something
// that looks like an entity reference (&word; or &#123; / &#x1a;).
const ESC_NO_ENCODE_RE = /[<>\"']|&(?!(#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|\w+);)/g;
const ESC_FULL_RE = /[&<>\"']/g;
function escText(s) {
  return s.replace(ESC_NO_ENCODE_RE, (c) => ESC_MAP[c]);
}
function escFull(s) {
  return s.replace(ESC_FULL_RE, (c) => ESC_MAP[c]);
}
// Decode numeric character references only (named entities pass through).
// 0, > 0x10FFFF and lone surrogates become U+FFFD; 38 becomes &amp;.
const NUM_REF_RE = /&#(?:(\d{1,7})|[Xx]([0-9A-Fa-f]{1,6}));/g;
const NUM_REF_TEST = /&#(?:\d{1,7}|[Xx][0-9A-Fa-f]{1,6});/;
function decodeNums(s) {
  if (!NUM_REF_TEST.test(s)) return s;
  return s.replace(NUM_REF_RE, (m, dec, hex) => {
    const cp = hex === undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}
// A href is encoded like the reference does: encodeURI with %25 put back.
function encodeHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}
// Link labels match case-insensitively with inner whitespace collapsed.
function normLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}
// End of a reference label starting at src[open] === '['. The reference
// label rule allows no spaces and no brackets inside (a newline is allowed
// only when the next line is not blank). Returns the index of ']' or -1.
function refLabelEnd(src, open) {
  let k = open + 1;
  const n = src.length;
  while (k < n) {
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (c === '[') return -1;
    if (c === ']') return k;
    if (c === ' ' || c === '\t') return -1;
    if (c === '\n') {
      // a newline is allowed only when the next line is not blank
      let m = k + 1;
      while (m < n && (src[m] === ' ' || src[m] === '\t')) m++;
      if (m >= n || src[m] === '\n') return -1;
      k++;
      continue;
    }
    k++;
  }
  return -1;
}
// Unescape backslash + ASCII punctuation.
const ANY_PUNCT_RE = /\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g;
function unescapePunct(s) {
  return s.replace(ANY_PUNCT_RE, '$1');
}

function isSpaceCh(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || (c > ' ' && /\s/.test(c));
}
function isPunctCh(c) {
  if (c < '\u0080') return '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.indexOf(c) >= 0;
  return /[\p{P}\p{S}]/u.test(c);
}
function isWordCh(c) {
  if (c < '\u0080') return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
  return /[\p{L}\p{N}]/u.test(c);
}
// Flanking of a delimiter run starting at `start` with length `len` in `src`.
function flanking(src, start, len) {
  const prev = start > 0 ? src[start - 1] : '';
  const next = start + len < src.length ? src[start + len] : '';
  const prevSpace = prev === '' || isSpaceCh(prev);
  const nextSpace = next === '' || isSpaceCh(next);
  const prevPunct = prev !== '' && isPunctCh(prev);
  const nextPunct = next !== '' && isPunctCh(next);
  return {
    left: !nextSpace && (!nextPunct || prevSpace || prevPunct),
    right: !prevSpace && (!prevPunct || nextSpace || nextPunct),
    prevPunct,
    nextPunct,
  };
}

// ---------- inline parsing ----------

// Token kinds: 't' text (final HTML already), 'd' delimiter run,
// 'h' pre-rendered HTML (code, br, link, image, raw html, escaped char),
// 'em'/'strong'/'del' wrapper nodes built by emphasis resolution.
const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const TAG_RE = /^(?:<!--(?:-?>|[\s\S]*?-->)|^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?)*\s*\/?>|^<\?[\s\S]*?\?>|^<![a-zA-Z]+\s[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>)/;
const AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/;
const EMAIL_RE = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
// Greedy email match without the trailing lookahead. The reference strips
// emphasis before it matches an email, so an address ending just before
// an emphasis closer ('_' or '__' followed by a non-word character) is
// the full address, while the lookahead regex above backtracks and drops
// its last domain segment. That only holds when an underscore opener is
// actually open (hasUnderscoreOpener): a trailing '_' with no opener is
// literal text and the reference links nothing there.
const EMAIL_FULL_RE = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+/;
function matchEmail(s, hasUnderscoreOpener) {
  const full = EMAIL_FULL_RE.exec(s);
  if (!full) return null;
  const after = s[full[0].length];
  if (after === '_') {
    if (!hasUnderscoreOpener) {
      const m = EMAIL_RE.exec(s);
      return m ? m[0] : null;
    }
    let q = full[0].length;
    while (s[q] === '_') q++;
    const next = s[q];
    if (next === undefined || next === '' || !/[\w-]/.test(next)) return full[0];
  } else if (after === undefined || after === '' || !/[\w-]/.test(after)) {
    return full[0];
  }
  // Followed by a word character or '-': fall back to the lookahead
  // regex, which backtracks (or fails) exactly as the reference does.
  const m = EMAIL_RE.exec(s);
  return m ? m[0] : null;
}
const SCHEME_RE = /^(?:https?|ftp):\/\//i;
const WWW_RE = /^www\.(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/;
const SCHEME_URL_RE = /^(?:https?|ftp):\/\/(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/i;
// mailto: takes a bare email; xmpp: takes an email plus one optional
// path segment of [A-Za-z0-9@.]. Both end with the email's lookahead,
// so a trailing - or _ after the domain is not a link.
const MAILTO_RE = /^(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?)/;
const CODE_SPAN_RE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const BR_RE = /^( {2,}|\\)\n(?!\s*$)/;
const ESCAPE_RE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/;
const DEL_RE = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;

// Trim an extended autolink the way the reference's backpedal does:
// trailing punctuation goes, balanced parens stay, an unmatched '(' cuts.
function backpedal(u) {
  let i = 0;
  const n = u.length;
  const punct = '?!.,:;*_\'"~)';
  while (i < n) {
    const ch = u[i];
    if (ch === '(') {
      const j = u.indexOf(')', i);
      if (j < 0) break;
      i = j + 1;
      continue;
    }
    if (ch === '&') {
      if (/^[a-zA-Z0-9]+;$/.test(u.slice(i + 1))) break;
      i++;
      continue;
    }
    if (punct.indexOf(ch) >= 0) {
      let j = i;
      while (j < n && punct.indexOf(u[j]) >= 0) j++;
      if (j >= n) break;
      i = j;
      continue;
    }
    i++;
  }
  return u.slice(0, i);
}

// Find the end of a label starting at `open` (src[open] === '[').
// Returns the index of the matching ']' or -1. Handles nested brackets,
// backslash escapes and code spans (a ']' inside a code span does not close).
function labelEnd(src, open) {
  let depth = 0;
  let k = open + 1;
  const n = src.length;
  while (k < n) {
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (c === '`') {
      // The reference's label pattern consumes a backtick run as a
      // code-span atom when ANY later backtick run follows (its closing
      // run need not match the opening length), and consumes 2+ backticks
      // immediately before ']'. A run with no later run and not before
      // ']' cannot be in a label, so the label does not close here.
      let m = k;
      while (m < n && src[m] === '`') m++;
      const run = m - k;
      let j = m;
      let closed = -1;
      while (j < n) {
        if (src[j] === '`') {
          let e = j;
          while (e < n && src[e] === '`') e++;
          closed = e;
          break;
        }
        j++;
      }
      if (closed < 0) {
        if (run >= 2 && src[m] === ']') { k = m; continue; }
        return -1;
      }
      k = closed;
      continue;
    }
    if (c === '[') { depth++; k++; continue; }
    if (c === ']') {
      if (depth === 0) return k;
      depth--; k++; continue;
    }
    k++;
  }
  return -1;
}

// Does the label text contain a '<' starting a tag/autolink that runs past
// the label's end? If so the link is not a link (reference rule).
function labelHasOpenTag(src, labelStart, label) {
  if (!label.includes('<')) return false;
  for (let s = 0; s < label.length; s++) {
    const c = label[s];
    if (c === '\\') { s++; continue; }
    if (c === '`') {
      const m = CODE_SPAN_RE.exec(label.slice(s));
      if (m) { s += m[0].length - 1; continue; }
    }
    if (c !== '<') continue;
    const rest = src.slice(labelStart + s);
    const m = TAG_RE.exec(rest) || AUTOLINK_RE.exec(rest);
    if (m && m[0].length > label.length - s) return true;
    if (m) s += m[0].length - 1;
  }
  return false;
}

// Parse an inline (or reference) link/image starting at src[i] ('[' or
// '!['). Returns { html, end } (end = index just past the closing ')'
// or ']' of a reference) or null when this is not a link. When `plain`
// is true the result is the label's plain text (for image alt text).
function tryLink(src, i, links, st, plain) {
  const isImg = src[i] === '!';
  const j = i + (isImg ? 1 : 0);
  if (src[j] !== '[') return null;
  const le = labelEnd(src, j);
  if (le < 0) return null;
  const label = src.slice(j + 1, le);
  if (labelHasOpenTag(src, j + 1, label)) return null;

  let dest = null;
  let title = null;
  let end = -1;
  const after = le + 1;
  let useShortcut = false;
  if (src[after] === '(') {
    // Inline link: ( dest (title)? )
    let p = after + 1;
    while (p < src.length && (src[p] === ' ' || src[p] === '\t' || src[p] === '\n')) p++;
    if (src[p] === ')') {
      dest = '';
      end = p + 1;
    } else {
      let href;
      if (src[p] === '<') {
        // angle-bracket destination: no newline, escapes allowed
        let q = p + 1;
        let ok = false;
        while (q < src.length) {
          const c = src[q];
          if (c === '\\') { q += 2; continue; }
          if (c === '>') { ok = true; break; }
          if (c === '\n') break;
          q++;
        }
        if (!ok) {
          // unterminated angle destination: not an inline link at all
          // (a bare destination never starts with '<'), so fall through
          // to the shortcut-reference attempt below
          dest = null;
          end = -1;
          // skip the rest of the inline-link attempt
          p = -1;
        } else {
          href = unescapePunct(src.slice(p + 1, q));
          p = q + 1;
        }
      } else {
        // bare destination, parentheses balanced, stops at whitespace;
        // backslashes are kept raw here (an escaped paren must not count
        // for depth) and unescaped only where they precede punctuation
        let raw = '';
        let depth = 0;
        let q = p;
        while (q < src.length) {
          const c = src[q];
          if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32) break;
          if (c === '\\') { raw += src.slice(q, q + 2); q += 2; continue; }
          if (c === '(') depth++;
          else if (c === ')') {
            if (depth === 0) break;
            depth--;
          }
          raw += c;
          q++;
        }
        href = unescapePunct(raw);
        p = q;
      }
      if (p === -1) {
        // angle destination failed: leave dest null, end -1 (shortcut below)
      } else {
        dest = href;
      }
      // optional title, then ')'
      let q = p < 0 ? src.length : p;
      while (q < src.length && (src[q] === ' ' || src[q] === '\t' || src[q] === '\n')) q++;
      if (src[q] === ')') {
        end = q + 1;
      } else {
        const qc = src[q];
        if (qc === '"' || qc === "'" || qc === '(') {
          const close = qc === '(' ? ')' : qc;
          let r = q + 1;
          let ok = false;
          while (r < src.length) {
            const c = src[r];
            if (c === '\\') { r += 2; continue; }
            if (c === close) { ok = true; break; }
            r++;
          }
          if (ok) {
            title = unescapePunct(src.slice(q + 1, r));
            let s2 = r + 1;
            while (s2 < src.length && (src[s2] === ' ' || src[s2] === '\t' || src[s2] === '\n')) s2++;
            if (src[s2] === ')') end = s2 + 1;
          }
        }
      }
    }
    if (end < 0) useShortcut = true; // not an inline link: try the shortcut
  } else if (src[after] === '[') {
    // Reference link: [label][ref]. The reference label follows the
    // same label rule as any label (spaces allowed, no blank line).
    if (src[after + 1] === ']') {
      // collapsed reference: [label][]
      const found = links.get(normLabel(label));
      if (!found) return null;
      dest = found.href;
      title = found.title;
      end = after + 2;
    } else {
      const re = labelEnd(src, after);
      if (re < 0) {
        useShortcut = true; // not a reference syntactically: try the shortcut
      } else {
        const ref = normLabel(src.slice(after + 1, re));
        const found = links.get(ref);
        if (!found) return null; // parsed as a reference but undefined
        dest = found.href;
        title = found.title;
        end = re + 1;
      }
    }
  } else {
    useShortcut = true;
  }
  if (useShortcut) {
    // Shortcut reference: [label]
    const found = links.get(normLabel(label));
    if (!found) return null;
    dest = found.href;
    title = found.title;
    end = after;
  }

  // Render the label's inline content. A link whose label itself contains
  // a link is not a link at all. Bare GFM autolinks do not fire inside a
  // label (the reference's inLink state); angle autolinks still do.
  const savedHasLink = st.hasLink;
  const savedRaw = st.inRawBlock;
  const savedInLink = st.inLink;
  st.hasLink = false;
  st.inLink = true;
  const inner = inline(label, links, st, plain);
  const labelHasLink = st.hasLink;
  st.hasLink = savedHasLink;
  st.inLink = savedInLink;
  if (!isImg && labelHasLink) {
    st.inRawBlock = savedRaw;
    return null;
  }
  // In plain mode a link or an image is just its label's text. A link
  // still counts as a link for an outer label's validity check.
  if (plain) {
    if (!isImg) st.hasLink = true;
    return { html: inner, end };
  }
  if (isImg) {
    const alt = escText(inline(label, links, st, true));
    const enc = encodeHref(dest);
    if (enc === null) {
      st.inRawBlock = savedRaw;
      return null;
    }
    let out = '<img src="' + escText(enc) + '" alt="' + alt + '"';
    if (title) out += ' title="' + escText(title) + '"';
    out += '>';
    return { html: out, end };
  }
  const enc = encodeHref(dest);
  if (enc === null) return { html: inner, end }; // link degrades to its text
  let out = '<a href="' + escText(enc) + '"';
  if (title) out += ' title="' + escText(title) + '"';
  out += '>' + inner + '</a>';
  st.hasLink = true;
  return { html: out, end };
}

// Resolve emphasis/delimiter runs in a token list (linked by p/n indices).
// Delimiter nodes hold c ('*' | '_' | '~'), n (run length), open, close and
// the linked-list links; other nodes hold their final HTML in s. When
// `plain` is true the result is plain text (for image alt text): wrappers
// render as their children with no tags.
function resolveEmphasis(toks, head, plain) {
  const stack = [];
  // Openers blocked for a single-delimiter closer: when a delimiter that
  // can both open and close is used as a closer, the reference treats it
  // as an opener too (its budget grows), so an earlier opener can no
  // longer be closed by a lone delimiter -- only a run of 2+ still can.
  // (This is what leaves the stray `*` literal in `**a *b*c* d**` and
  // the outer `*` literal in `*a **b**c*`.)
  const blockedSingle = new Set();
  let cur = head;
  while (cur !== -1) {
    const node = toks[cur];
    if (node.k === 'd') {
      if (node.close) {
        let oi = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          const op = toks[stack[s]];
          if (op.c !== node.c) continue;
          // A lone closer cannot match an opener blocked by an earlier
          // both-open-and-close delimiter; a run of 2+ still can.
          if (node.n < 2 && blockedSingle.has(stack[s])) continue;
          // Rule of 3: when either delimiter can both open and close,
          // a match whose run lengths sum to a multiple of 3 is barred
          // unless both lengths are multiples of 3.
          if ((op.open && op.close) || (node.open && node.close)) {
            const sum = op.n + node.n;
            if (sum % 3 === 0 && (op.n % 3 !== 0 || node.n % 3 !== 0)) continue;
          }
          oi = s;
          break;
        }
        if (oi >= 0) {
          const op = toks[stack[oi]];
          // A '~' closer only matches when the content does not end in '~'.
          let blocked = false;
          if (node.c === '~') {
            const last = toks[node.pv];
            if (last && last.k === 't' && last.s.endsWith('~')) blocked = true;
          }
          if (!blocked) {
            const use = op.n >= 2 && node.n >= 2 ? 2 : 1;
            const kind = node.c === '~' ? 'del' : use === 2 ? 'strong' : 'em';
            const after = node.nx;
            const opIdx = stack[oi];
            const closerLen = node.n;
            op.n -= use;
            node.n -= use;
            const wrapIdx = toks.length;
            const wrap = { k: kind, ch: [], pv: -1, nx: -1 };
            // collect the children between opener and closer
            let c = toks[opIdx].nx;
            while (c !== -1 && c !== cur) {
              wrap.ch.push(toks[c]);
              c = toks[c].nx;
            }
            // Place the wrapper where the opener was; a leftover opener
            // stays in the list in front of it (rendering as literal
            // delimiters) and stays in the stack.
            if (op.n > 0) {
              wrap.pv = opIdx;
              wrap.nx = node.n === 0 ? after : cur;
              toks[opIdx].nx = wrapIdx;
            } else {
              wrap.pv = toks[opIdx].pv;
              wrap.nx = node.n === 0 ? after : cur;
              if (wrap.pv !== -1) toks[wrap.pv].nx = wrapIdx;
              else head = wrapIdx;
            }
            if (node.n === 0) {
              if (after !== -1) toks[after].pv = wrapIdx;
            } else {
              node.pv = wrapIdx;
            }
            toks.push(wrap);
            // Delimiters between the opener and the closer are now
            // inside the emphasis node: drop them from the stack, keeping
            // the opener only when it still has delimiters left.
            // If the closer could also open, every opener before the one
            // just matched is now blocked for a lone closer -- but only
            // when the matched opener itself cannot close, and only for
            // an opener that needs 2 delimiters (a `**` opener) or when
            // the closer itself is a run of 2+. A lone `*` opener before
            // a lone `*` both-delimiter still closes (cf. doc-21).
            if (node.open && !op.close) {
              for (let s = 0; s < oi; s++) {
                const outer = toks[stack[s]];
                if (outer.c !== node.c) continue;
                if (outer.n >= 2 || closerLen >= 2) blockedSingle.add(stack[s]);
              }
            }
            stack.length = oi + (op.n > 0 ? 1 : 0);
            // A leftover closer is re-processed: it may still match an
            // earlier opener (this is how ***foo*** nests em around strong).
            cur = node.n > 0 ? cur : after;
            continue;
          }
        }
      }
      if (node.open) stack.push(cur);
      cur = toks[cur].nx;
    } else {
      cur = toks[cur].nx;
    }
  }
  // render: walk from the head, delimiters left over become literal chars
  let out = '';
  let i = head;
  while (i !== -1) {
    const node = toks[i];
    if (node.k === 'd') {
      out += node.c.repeat(node.n);
    } else if (node.k === 't' || node.k === 'h') {
      out += node.s;
    } else {
      out += renderWrapper(node, plain);
    }
    i = toks[i].nx;
  }
  return out;
}
function renderWrapper(node, plain) {
  const tag = node.k;
  let out = plain ? '' : '<' + tag + '>';
  for (const child of node.ch) {
    if (child.k === 'd') out += child.c.repeat(child.n);
    else if (child.k === 't' || child.k === 'h') out += child.s;
    else out += renderWrapper(child, plain);
  }
  out += plain ? '' : '</' + tag + '>';
  return out;
}

// Inline-parse a source string. `st` carries { hasLink, inRawBlock };
// when `plain` is true the result is unescaped plain text (for image alt).
function inline(src, links, st, plain) {
  const n = src.length;
  const toks = [];
  let head = -1;
  let tail = -1;
  // Unmatched '_' openers seen so far in this inline string, simulated
  // as the tokenizer goes (a closer consumes the most recent opener).
  // Used only to tell an email followed by '_' whether that '_' can be
  // an emphasis closer (the reference strips emphasis first).
  let usOpen = 0;
  const push = (node) => {
    node.pv = tail;
    node.nx = -1;
    if (tail !== -1) toks[tail].nx = toks.length;
    else head = toks.length;
    tail = toks.length;
    toks.push(node);
  };
  const pushText = (raw) => {
    if (raw === '') return;
    push({ k: 't', s: plain ? decodeNums(raw) : escText(decodeNums(raw)) });
  };
  let i = 0;
  let textStart = 0;
  const flushText = (to) => {
    if (to > textStart) pushText(src.slice(textStart, to));
  };
  while (i < n) {
    const c = src[i];
    // --- hard break: two or more spaces + newline. The leading
    // whitespace of the next line is stripped after a hard break. ---
    if (c === ' ' && src[i + 1] === ' ') {
      const bm = BR_RE.exec(src.slice(i));
      if (bm) {
        flushText(i);
        if (!plain) push({ k: 'h', s: '<br>' });
        i += bm[0].length;
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
        textStart = i;
        continue;
      }
    }
    // --- escape / hard break ---
    if (c === '\\') {
      if (i + 1 < n && ASCII_PUNCT.indexOf(src[i + 1]) >= 0) {
        flushText(i);
        push({ k: 'h', s: plain ? src[i + 1] : escText(src[i + 1]) });
        i += 2;
        textStart = i;
        continue;
      }
      const bm = BR_RE.exec(src.slice(i));
      if (bm) {
        flushText(i);
        if (!plain) push({ k: 'h', s: '<br>' });
        i += bm[0].length;
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // --- code span ---
    if (c === '`') {
      const cm = CODE_SPAN_RE.exec(src.slice(i));
      if (cm) {
        flushText(i);
        let code = cm[2].replace(/\n/g, ' ');
        if (/[^\s]/.test(code) && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
        push({ k: 'h', s: plain ? code : '<code>' + escFull(code) + '</code>' });
        i += cm[0].length;
        textStart = i;
        continue;
      }
      // no span starts here: the whole backtick run is literal text
      while (i < n && src[i] === '`') i++;
      continue;
    }
    // --- raw html / autolink ---
    if (c === '<') {
      const tm = TAG_RE.exec(src.slice(i));
      if (tm) {
        flushText(i);
        // The reference's lexer state persists across blocks: an <a>
        // opening tag sets inLink (disabling GFM autolinks, including
        // emails, until a </a>), and <pre>/<code>/<kbd>/<script> set
        // inRawBlock. An unclosed <a> therefore leaks into later blocks.
        const tag = tm[0];
        if (!st.inLink && /^<a[ \t]/i.test(tag)) st.inLink = true;
        else if (st.inLink && /^<\/a[ \t>]/i.test(tag)) st.inLink = false;
        if (!st.inRawBlock && /^<(pre|code|kbd|script)(?:[ \t>]|$)/i.test(tag)) st.inRawBlock = true;
        else if (st.inRawBlock && /^<\/(pre|code|kbd|script)(?:[ \t>]|$)/i.test(tag)) st.inRawBlock = false;
        // In plain mode the reference's text renderer keeps raw HTML.
        push({ k: 'h', s: tag });
        i += tag.length;
        textStart = i;
        continue;
      }
      const am = AUTOLINK_RE.exec(src.slice(i));
      if (am) {
        flushText(i);
        const innerText = am[1];
        const isMail = innerText.indexOf('@') > 0 && innerText.indexOf(':') < 0;
        const href = isMail ? 'mailto:' + innerText : innerText;
        if (plain) pushText(innerText);
        else {
          // An angle autolink inside a link label does NOT invalidate
          // the outer link (the reference still forms it), so it does
          // not set hasLink.
          const enc = encodeHref(href);
          push({ k: 'h', s: '<a href="' + escFull(enc === null ? href : enc) + '">' + escFull(innerText) + '</a>' });
        }
        i += am[0].length;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // --- link / image ---
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const res = tryLink(src, i, links, st, plain);
      if (res) {
        flushText(i);
        push({ k: 'h', s: res.html });
        i = res.end;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // --- delimiter runs ---
    if (c === '*' || c === '_') {
      let j = i;
      while (j < n && src[j] === c) j++;
      let len = j - i;
      const fl = flanking(src, i, len);
      let canOpen = fl.left;
      let canClose = fl.right;
      if (c === '_') {
        canOpen = fl.left && (!fl.right || fl.prevPunct);
        canClose = fl.right && (!fl.left || fl.nextPunct);
      }
      flushText(i);
      push({ k: 'd', c, n: len, open: canOpen, close: canClose });
      if (c === '_') {
        if (canClose && usOpen > 0) usOpen--;
        if (canOpen) usOpen++;
      }
      i = j;
      textStart = i;
      continue;
    }
    // --- strikethrough delimiter run: resolved by the delimiter stack
    // like * and _, so nested ~~ pairs work. A run of 3 or more tildes
    // is not a delimiter at all (the reference leaves it literal). ---
    if (c === '~') {
      let j = i;
      while (j < n && src[j] === '~') j++;
      const len = j - i;
      if (len > 2) { i = j; continue; }
      const fl = flanking(src, i, len);
      flushText(i);
      push({ k: 'd', c, n: len, open: fl.left, close: fl.right });
      i = j;
      textStart = i;
      continue;
    }
    // --- extended autolinks. A scheme URL is linkified anywhere (the
    // reference's text token stops before protocol:// with no lookbehind);
    // www. only after whitespace, *, _, ~, ( or ) or at the start; an
    // email anywhere. On a miss, fall through so a word starting with
    // h/f/w/m/x can still be an email. ---
    if ((c === 'h' || c === 'H' || c === 'f' || c === 'F') && !st.inLink) {
      const um = SCHEME_URL_RE.exec(src.slice(i));
      if (um) {
        const url = backpedal(um[0]);
        if (url.length > 0) {
          flushText(i);
          if (plain) pushText(url);
          else {
            // The reference encodes the href (encodeURI: ']' -> %5D,
            // '\' -> %5C) while the link text stays the raw URL.
            const enc = encodeHref(url);
            push({ k: 'h', s: '<a href="' + escText(enc === null ? url : enc) + '">' + escText(url) + '</a>' });
            st.hasLink = true;
          }
          i += url.length;
          textStart = i;
          continue;
        }
      }
    }
    if (c === 'w' && !st.inLink) {
      const wm = WWW_RE.exec(src.slice(i));
      const wp = i === 0 ? '' : src[i - 1];
      if (wm && (i === 0 || isSpaceCh(wp) || wp === '*' || wp === '_' || wp === '~' || wp === '(' || wp === ')')) {
        const url = backpedal(wm[0]);
        if (url.length > 0) {
          flushText(i);
          if (plain) pushText(url);
          else {
            const enc = encodeHref('http://' + url);
            push({ k: 'h', s: '<a href="' + escText(enc === null ? 'http://' + url : enc) + '">' + escText(url) + '</a>' });
            st.hasLink = true;
          }
          i += url.length;
          textStart = i;
          continue;
        }
      }
    }
    if ((c === 'm' || c === 'x') && !st.inLink) {
      const mm = MAILTO_RE.exec(src.slice(i));
      if (mm) {
        flushText(i);
        const url = mm[0];
        if (plain) pushText(url);
        else {
          push({ k: 'h', s: '<a href="' + escText(url) + '">' + escText(url) + '</a>' });
          st.hasLink = true;
        }
        i += url.length;
        textStart = i;
        continue;
      }
    }
    // --- email autolink (no brackets) ---
    if ((isWordCh(c) || c === '.' || c === '-' || c === '_' || c === '+' || c === '%') && !st.inLink) {
      const addr = matchEmail(src.slice(i), usOpen > 0);
      if (addr) {
        flushText(i);
        if (plain) pushText(addr);
        else {
          push({ k: 'h', s: '<a href="mailto:' + escText(addr) + '">' + escText(addr) + '</a>' });
          st.hasLink = true;
        }
        i += addr.length;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flushText(n);
  return resolveEmphasis(toks, head, plain);
}

// ---------- block parsing ----------

// Expand tabs to spaces, counting columns from `off` (the column at which
// the string starts). A tab advances to the next multiple of 4.
function J(s, off) {
  let t = off, out = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\t') { const r = 4 - (t % 4); out += ' '.repeat(r); t += r; }
    else { out += ch; t++; }
  }
  return out;
}
// Remove one level of indented-code indent from a line: 0-3 spaces + a tab,
// or 1-4 spaces.
function codeRemoveIndentLine(line) {
  const m = /^(?: {0,3}\t| {1,4})/.exec(line);
  return m ? line.slice(m[0].length) : line;
}
function isCodeLike(line) {
  return /^(?: {4}| {0,3}\t)/.test(line);
}
// Link-label normalisation: trim, collapse inner whitespace, lowercase.
function F(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}
// Index of the first unbalanced closing paren in `a` (-1 when the parens
// balance or there are none, -2 when a paren is left open).
function ke(a) {
  if (a.indexOf('(') === -1 && a.indexOf(')') === -1) return -1;
  let t = 0;
  for (let n = 0; n < a.length; n++) {
    if (a[n] === '\\') n++;
    else if (a[n] === '(') t++;
    else if (a[n] === ')' && (t--, t < 0)) return n;
  }
  return t > 0 ? -2 : -1;
}

// Columns of leading whitespace (a tab advances to the next multiple of 4).
function indentColumns(ln) {
  let col = 0;
  let i = 0;
  while (i < ln.length) {
    const c = ln[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return col;
}
// The line with up to `k` columns of leading indent removed. A tab that
// straddles the boundary leaves its remainder as spaces.
function stripIndent(ln, k) {
  let col = 0;
  let idx = 0;
  while (idx < ln.length && col < k) {
    const c = ln[idx];
    if (c === ' ') { col++; idx++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= k) { col += w; idx++; }
      else return ' '.repeat(col + w - k) + ln.slice(idx + 1);
    } else break;
  }
  return ln.slice(idx);
}
function isBlank(ln) {
  return ln.trim() === '';
}

// Parse a list marker at the start of a line (indent at most 3). Returns
// null or { bullet, marker, ordered, delim, start, indent, contentIndent,
// content } where content is the item's first line after the marker (with
// the marker indent removed the way the reference does it: the whitespace
// after the marker is expanded to spaces relative to the marker column, and
// when that is more than 4 the content indent is marker + 1).
function parseMarker(ln) {
  const m = /^( {0,3})([*+-]|\d{1,9}[.)])([ \t]*)(.*)$/.exec(ln);
  if (!m) return null;
  const leadLen = m[1].length;
  const marker = m[2];
  const ws = m[3];
  const rest = m[4];
  if (ws === '' && rest !== '') return null;
  const b = leadLen + marker.length;
  const isOrdered = marker[0] >= '0' && marker[0] <= '9';
  if (rest === '') {
    return { bullet: !isOrdered, marker, ordered: isOrdered, delim: isOrdered ? marker[marker.length - 1] : '', start: isOrdered ? parseInt(marker, 10) : 0, indent: leadLen, contentIndent: b + 1, content: '' };
  }
  const expanded = J(ws, b) + rest;
  let R = J(ws, b).length;
  if (R > 4) R = 1;
  return { bullet: !isOrdered, marker, ordered: isOrdered, delim: isOrdered ? marker[marker.length - 1] : '', start: isOrdered ? parseInt(marker, 10) : 0, indent: leadLen, contentIndent: b + R, content: expanded.slice(R) };
}

// Does this line (already stripped of up to 3 spaces of indent) start a
// block that can interrupt a paragraph? Setext underlines and indented code
// cannot interrupt one, so they are not listed here.
function startsBlockInterrupt(content) {
  if (content === '') return false;
  if (/^#{1,6}(?:[ \t]+|[ \t]*$)/.test(content)) return true;
  if (/^(`{3,}|~{3,})/.test(content)) return true;
  if (content.startsWith('>')) return true;
  if (/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(content)) return true;
  if (parseMarker(content)) return true;
  if (htmlBlockType(content, true) > 0) return true;
  return false;
}

// HTML block type (1-7) for a line, or 0. Type 7 only counts when no
// paragraph is open.
function htmlBlockType(content, paraOpen) {
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(content)) return 1;
  if (/^<!--/.test(content)) return 2;
  if (/^<\?/.test(content)) return 3;
  if (/^<![A-Za-z]/.test(content)) return 4;
  if (/^<!\[CDATA\[/.test(content)) return 5;
  if (/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]+|\/?>|$)/i.test(content)) return 6;
  // Type 7: a complete open tag (attributes allowed) or a closing tag
  // (no attributes) alone on the line.
  if (!paraOpen && (/^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/.test(content) || /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/.test(content))) return 7;
  return 0;
}
function htmlBlockEnd(type, ln) {
  if (type === 1) return /<\/(?:script|pre|style|textarea)>/i.test(ln);
  if (type === 2) return /-->/.test(ln);
  if (type === 3) return /\?>/.test(ln);
  if (type === 4) return />/.test(ln);
  if (type === 5) return /\]\]>/.test(ln);
  return false; // types 6 and 7 end at the first blank line
}

// Try to read a link reference definition starting at lines[i] (content is
// that line with up to 3 spaces stripped). Returns { href, title, next,
// label } or null. The label follows the reference's label rule (no spaces
// inside); a bare destination must have balanced parentheses.
// Link reference definition, mirroring marked's `def` regex (Fe): the
// label may contain spaces and may span lines (but not a blank line), the
// destination may sit on the next line, and the title may sit on the next
// line and may itself span lines (single-quoted titles not across a blank
// line). Returns { href, title, next, label } or null.
const DEF_LABEL = String.raw`(?:\\[\s\S]|[^\[\]\n]|\n(?![ \t]*\n))+`;
const DEF_TITLE = String.raw`(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))`;
const DEF_RE = new RegExp(
  '^ {0,3}\\[(?!\\s*\\])(' + DEF_LABEL + ')\\]: *(?:\\n[ \t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \t]*)?| *\\n[ \t]*)(' + DEF_TITLE + '))? *(?:\\n+|$)'
);
function tryDef(content, lines, i) {
  if (content[0] !== '[') return null;
  // join this line (already stripped of up to 3 leading spaces) with the
  // following lines up to the next blank line; a definition never spans a
  // blank line
  let j = i + 1;
  while (j < lines.length && !isBlank(lines[j])) j++;
  const text = content + (j > i + 1 ? '\n' + lines.slice(i + 1, j).join('\n') : '');
  const m = DEF_RE.exec(text);
  if (!m) return null;
  const rawDest = m[2];
  // a bare destination must have balanced parentheses
  if (rawDest[0] !== '<' && ke(rawDest) !== -1) return null;
  const href = rawDest[0] === '<'
    ? unescapePunct(rawDest.slice(1, -1))
    : unescapePunct(rawDest);
  const title = m[3] === undefined ? null : unescapePunct(m[3].slice(1, -1));
  // the definition spans as many lines as there are newlines in its raw
  // text (trailing newlines stripped)
  const raw = m[0].replace(/\n+$/, '');
  const next = i + 1 + (raw.match(/\n/g) || []).length;
  return { href, title, next, label: F(m[1]) };
}
// ---------- list parsing ----------

function parseList(lines, i, links, collectOnly, docSt) {
  const first = parseMarker(lines[i]);
  const sameList = (m) => m.bullet === first.bullet && (first.bullet ? m.marker === first.marker : m.delim === first.delim);
  const items = [];
  let curLines = [first.content];
  let curLazy = new Set();
  let curCI = first.contentIndent;
  let loose = false;
  let lastWasBlank = false;
  // Fenced code block state inside the current item (for the lazy-line
  // rule): a lazy line right after a fence opener, before any indented
  // content line, is not fence content -- the fence is empty and the
  // list ends. Once the fence has an indented content line, later lazy
  // lines are code content.
  let fenceCh = null;
  let fenceLen = 0;
  let fenceHasContent = false;
  const trackFence = (line) => {
    const c = stripIndent(line, 3);
    if (fenceCh !== null) {
      const cm = /^(`{3,}|~{3,})[ \t]*$/.exec(c);
      if (cm && cm[1][0] === fenceCh && cm[1].length >= fenceLen) {
        fenceCh = null; fenceLen = 0; fenceHasContent = false;
      } else {
        fenceHasContent = true;
      }
      return;
    }
    const fm = /^(`{3,}|~{3,})([^\n]*)$/.exec(c);
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
      fenceCh = fm[1][0]; fenceLen = fm[1].length; fenceHasContent = false;
    }
  };
  trackFence(first.content);
  let j = i + 1;
  const finishItem = () => {
    while (curLines.length && curLines[curLines.length - 1] === '') curLines.pop();
    items.push({ lines: curLines, lazy: curLazy, contentIndent: curCI });
  };
  while (j < lines.length) {
    const ln = lines[j];
    if (isBlank(ln)) {
      let k = j + 1;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k >= lines.length) break;
      const nm = parseMarker(lines[k]);
      if (curLines.every((l) => l === '')) {
        // an empty item followed by a blank line ends the item; the list
        // only continues if the next line starts a new item of this list
        // (the trailing finishItem pushes the empty item, so only finish
        // here when a new item actually follows). A marker indented to
        // the item's content indent is a nested list, not a new item.
        if (nm && sameList(nm) && indentColumns(lines[k]) < curCI) {
          loose = true;
          finishItem();
          curLines = [nm.content];
          curLazy = new Set();
          curCI = nm.contentIndent;
          lastWasBlank = false;
          fenceCh = null; fenceLen = 0; fenceHasContent = false;
          trackFence(nm.content);
          j = k + 1;
          continue;
        }
        break;
      }
      if (nm && sameList(nm) && indentColumns(lines[k]) < curCI) {
        loose = true;
        finishItem();
        curLines = [nm.content];
        curLazy = new Set();
        curCI = nm.contentIndent;
        lastWasBlank = false;
        fenceCh = null; fenceLen = 0; fenceHasContent = false;
        trackFence(nm.content);
        j = k + 1;
        continue;
      }
      // If the next non-blank line is not part of this item (its indent
      // is below the content indent and it is not a new item), the blank
      // line does not belong to the item either: leave it unconsumed so
      // the outer context can see it (it may separate blocks there).
      if (indentColumns(lines[k]) < curCI) break;
      curLines.push('');
      lastWasBlank = true;
      j++;
      continue;
    }
    const ind = indentColumns(ln);
    if (ind >= curCI) {
      const Z = ln.replace(/^[ \t]+/, (mm) => J(mm, 0));
      const contentLine = Z.slice(curCI);
      curLines.push(contentLine);
      trackFence(contentLine);
      lastWasBlank = false;
      j++;
      continue;
    }
    // a thematic break at a lower indent ends the list (but one inside
    // the item's content indent was handled above as item content)
    if (/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(stripIndent(ln, 3))) break;
    const m = parseMarker(ln);
    if (m) {
      if (sameList(m)) {
        finishItem();
        curLines = [m.content];
        curLazy = new Set();
        curCI = m.contentIndent;
        lastWasBlank = false;
        fenceCh = null; fenceLen = 0; fenceHasContent = false;
        trackFence(m.content);
        j++;
        continue;
      }
      break; // a different list at a lower indent ends this one
    }
    // lazy paragraph continuation, or the list ends
    if (lastWasBlank) break;
    // A lazy line right after a fence opener (the fence has no content
    // line yet) is not fence content: the fence is empty and the list
    // ends here; the lazy line belongs to the outer context.
    if (fenceCh !== null && !fenceHasContent) break;
    // A lazy line can only interrupt the paragraph when its block start
    // sits at an indent the reference allows (its D-clamped limit:
    // at most 3, and at most one less than the item's content indent).
    const limit = Math.min(3, curCI - 1);
    const content = stripIndent(ln, 3);
    if (ind <= limit && startsBlockInterrupt(content)) break;
    // a setext underline as a lazy line is literal text, not a heading:
    // indent it by 4 spaces so the re-parse treats it as code merged
    // into the paragraph (contributing just its text)
    const sm = /^(=+|-+)[ \t]*$/.exec(content);
    if (sm) {
      curLines.push('    ' + content);
      curLazy.add(curLines.length - 1);
    } else {
      curLines.push(ln);
      curLazy.add(curLines.length - 1);
    }
    if (fenceCh !== null) fenceHasContent = true;
    lastWasBlank = false;
    j++;
  }
  finishItem();
  // Looseness: a blank line between items (already tracked above), or a
  // blank line separating two blocks inside any item. The latter is
  // decided by a probe render of each item: blank lines absorbed by a
  // nested block do not make the outer list loose.
  if (!loose) {
    for (const it of items) {
      const probe = renderBlocks(it.lines.join('\n'), links, true, true, it.lazy, true);
      if (probe.loose) { loose = true; break; }
    }
  }
  let html = first.bullet ? '<ul>\n' : '<ol' + (first.start !== 1 ? ' start="' + first.start + '"' : '') + '>\n';
  for (const it of items) {
    // Task list item: `[ ] ` / `[x] ` / `[X] ` at the start of the item's
    // first line, followed by text. The checkbox is rendered only when
    // the item's first block is a paragraph; otherwise the marker stays
    // literal text.
    let text = it.lines.join('\n');
    let checkbox = null;
    const firstLine = it.lines[0] || '';
    const tm = /^\[[ xX]\][ \t]+\S/.test(firstLine) ? /^\[([ xX])\][ \t]+/.exec(firstLine) : null;
    if (tm) {
      const stripped = firstLine.replace(/^\[[ xX]\][ \t]+/, '');
      const lines2 = it.lines.slice();
      lines2[0] = stripped;
      text = lines2.join('\n');
      checkbox = tm[1] === ' '
        ? '<input disabled="" type="checkbox"> '
        : '<input checked="" disabled="" type="checkbox"> ';
    }
    const res = renderBlocks(text, links, !loose, collectOnly, it.lazy, true, undefined, docSt);
    let inner = res.html;
    if (checkbox && res.firstType === 'paragraph') {
      if (inner.startsWith('<p>')) inner = '<p>' + checkbox + inner.slice(3);
      else inner = checkbox + inner;
    } else if (checkbox) {
      inner = renderBlocks(it.lines.join('\n'), links, !loose, collectOnly, it.lazy, true, undefined, docSt).html;
    }
    html += '<li>' + inner + '</li>\n';
  }
  html += first.bullet ? '</ul>\n' : '</ol>\n';
  return { html, next: j };
}

// Is the innermost content of `line` (after stripping every leading
// blockquote marker, and one list marker's content) a paragraph line?
// A lazy line continues the blockquote only when the innermost paragraph
// is open: a nested blockquote or a list item whose first line is text
// still has its paragraph open.
function innermostParaOpen(line, paraOpen) {
  let t = line;
  for (;;) {
    const m = /^ {0,3}>([ \t]?)/.exec(t);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  t = stripIndent(t, 3);
  if (t.trim() === '') return false;
  const lm = parseMarker(t);
  if (lm) return innermostParaOpen(lm.content, paraOpen);
  // A fence cannot interrupt an open paragraph: if a paragraph is open,
  // a fence line is a paragraph continuation (inline code span), so the
  // paragraph stays open.
  if (paraOpen && /^(`{3,}|~{3,})/.test(t)) return true;
  return !startsBlockInterrupt(t);
}

// ---------- blockquote parsing ----------

function parseBlockquote(lines, i, links, tight, collectOnly, lazySet, docSt) {
  const n = lines.length;
  const rawLines = [];
  let j = i;
  // A lazy (non-'>') line is a continuation only while the inner
  // paragraph is open; a '>' line whose content is blank or starts a
  // block closes it.
  let innerPara = false;
  // collect the blockquote's lines: a line starting with > (indent <= 3),
  // or a lazy continuation (non-blank line while a paragraph is open)
  while (j < n) {
    const ln = lines[j];
    const m = /^ {0,3}>([ \t]?)/.exec(ln);
    if (m) {
      rawLines.push(ln);
      innerPara = innermostParaOpen(ln, innerPara);
      j++;
      continue;
    }
    if (isBlank(ln)) break;
    // lazy line: only while the previous collected line is a paragraph line
    // (a lazy line after a code/heading/hr/html/table line does not belong)
    if (rawLines.length === 0) break;
    if (!innerPara) break;
    // a lazy line that starts a new block (heading, fence, hr, list, html)
    // ends the blockquote instead of joining it
    if (indentColumns(ln) <= 3 && startsBlockInterrupt(stripIndent(ln, 3))) break;
    rawLines.push(ln);
    j++;
  }
  // group the lines the way marked's loop does: lazy lines may precede the
  // first > line of a group, but once a > line is seen the next lazy line
  // starts a new group
  const groups = [];
  let cur = [];
  let seenMarker = false;
  for (const ln of rawLines) {
    const isMarker = /^ {0,3}>/.test(ln);
    if (isMarker) {
      cur.push(ln);
      seenMarker = true;
    } else if (!seenMarker) {
      cur.push(ln);
    } else {
      groups.push(cur);
      cur = [ln];
      seenMarker = false;
    }
  }
  if (cur.length) groups.push(cur);
  // apply marked's three replacements to each group
  const contents = groups.map((g) => {
    let h = g.join('\n');
    // 1. expand the whitespace after the > marker (tab-aware)
    h = h.replace(/^( {0,3}>)([ \t]+)/gm, (mm, b, w) => b + J(w, b.length));
    // 2. a setext underline that follows a newline in the same group is
    // shifted right by four spaces, so it can no longer close a heading
    h = h.replace(/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, '\n    $1');
    // 3. strip the > marker and at most one following space or tab
    h = h.replace(/^ {0,3}>[ \t]?/gm, '');
    return h;
  });
  const lazyLines = new Set();
  rawLines.forEach((ln, idx) => {
    if (!/^ {0,3}>/.test(ln)) lazyLines.add(idx);
  });
  // A lazy line that starts a new group is tokenized on its own by the
  // reference, so a code-like one is a code block merged into the
  // paragraph with its indent stripped; a lazy line inside a group is
  // tokenized with the paragraph, keeping its spaces.
  const groupStarts = new Set();
  let gidx = 0;
  for (const g of groups) {
    if (!/^ {0,3}>/.test(g[0])) groupStarts.add(gidx);
    gidx += g.length;
  }
  // Process the groups one at a time, as marked's loop does. After a group
  // whose content ends in a code, heading, hr, html or table block, the
  // blockquote stops: the remaining lines belong to the outer context.
  // (A paragraph, list or nested blockquote does not stop it.)
  const BREAK_TYPES = ['code', 'heading', 'hr', 'html', 'table'];
  let content = '';
  let inner = '';
  let usedRaw = 0;
  let gi = 0;
  for (; gi < contents.length; gi++) {
    const acc = content === '' ? contents[gi] : content + '\n' + contents[gi];
    const res = renderBlocks(acc, links, tight, collectOnly, lazyLines, false, groupStarts, docSt);
    content = acc;
    inner = res.html;
    usedRaw += groups[gi].length;
    if (gi < contents.length - 1 && BREAK_TYPES.includes(res.lastType)) break;
  }
  const next = i + usedRaw;
  return { next, html: '<blockquote>\n' + inner + '</blockquote>\n' };
}

function splitRow(line) {
  const cells = [];
  let cur = '';
  let k = 0;
  const n = line.length;
  while (k < n) {
    const c = line[k];
    if (c === '\\' && k + 1 < n && (line[k + 1] === '|' || line[k + 1] === '\\')) {
      cur += line[k + 1];
      k += 2;
      continue;
    }
    if (c === '|') {
      cells.push(cur);
      cur = '';
      k++;
      continue;
    }
    cur += c;
    k++;
  }
  cells.push(cur);
  return cells;
}
function tryTable(lines, i, links, collectOnly, docSt) {
  if (i + 1 >= lines.length) return null;
  const headerLine = lines[i];
  const delimLine = lines[i + 1];
  if (!delimLine.includes('|') && !delimLine.includes(':')) return null;
  let dc = splitRow(delimLine.trim());
  if (dc.length && dc[0].trim() === '') dc = dc.slice(1);
  if (dc.length && dc[dc.length - 1].trim() === '') dc = dc.slice(0, -1);
  for (const c of dc) {
    if (!/^:?-+:?$/.test(c.trim())) return null;
  }
  let hc = splitRow(headerLine);
  if (hc.length && hc[0].trim() === '') hc = hc.slice(1);
  if (hc.length && hc[hc.length - 1].trim() === '') hc = hc.slice(0, -1);
  if (hc.length !== dc.length || hc.length === 0) return null;
  const aligns = dc.map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return null;
  });
  const st = docSt;
  let html = '<table>\n<thead>\n<tr>\n';
  for (let x = 0; x < hc.length; x++) {
    html += '<th' + (aligns[x] ? ' align="' + aligns[x] + '"' : '') + '>' + inline(hc[x].trim(), links, st, false) + '</th>\n';
  }
  html += '</tr>\n</thead>\n';
  const rows = [];
  let j = i + 2;
  // A table body row is any line that is not a blank line of spaces only
  // (the reference's body pattern excludes ` *\n` but not a tab: a
  // tab-only line is a row of empty cells), and not the start of another
  // block or an indented code block. A line with no `|` is still a row
  // (its content goes in the first cell, the rest are empty).
  while (j < lines.length && !/^ *$/.test(lines[j])) {
    const rcontent = stripIndent(lines[j], 3);
    if (startsBlockInterrupt(rcontent)) break;
    if (isCodeLike(lines[j]) && lines[j].trim() !== '') break;
    rows.push(lines[j]);
    j++;
  }
  if (rows.length > 0) {
    html += '<tbody>';
    for (const row of rows) {
      let rc = splitRow(row);
      if (rc.length && rc[0].trim() === '') rc = rc.slice(1);
      if (rc.length && rc[rc.length - 1].trim() === '') rc = rc.slice(0, -1);
      html += '<tr>\n';
      for (let x = 0; x < hc.length; x++) {
        const cell = x < rc.length ? rc[x].trim() : '';
        html += '<td' + (aligns[x] ? ' align="' + aligns[x] + '"' : '') + '>' + inline(cell, links, st, false) + '</td>\n';
      }
      html += '</tr>\n';
    }
    html += '</tbody>';
  }
  html += '</table>\n';
  return { html, next: j };
}

// ---------- main block renderer ----------

function renderBlocks(src, links, tight, collectOnly, lazySet, inList, groupStarts, docSt) {
  // Document-level inline state (inLink/inRawBlock) persists across
  // blocks within a pass; a fresh one is made when not supplied (e.g.
  // the looseness probe, whose inline parsing must not leak state).
  if (!docSt) docSt = { hasLink: false, inLink: false, inRawBlock: false };
  const lines = src.split('\n');
  const srcEndsNL = src.endsWith('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const n = lines.length;
  // A whitespace-only line is blank, except the final line of a source
  // that does not end with a newline: the reference's paragraph regex
  // keeps such a line as paragraph text (it is only blank when a \n
  // follows it).
  const isBlankLine = (idx) => {
    const ln = lines[idx];
    if (ln.trim() !== '') return false;
    return !(idx === lines.length - 1 && !srcEndsNL);
  };
  let out = '';
  let i = 0;
  let para = null;
  let lastType = '';
  let firstType = '';
  let loose = false;
  let blankAfterBlock = false;
  const setType = (t) => { if (!firstType) firstType = t; lastType = t; };
  const flushPara = () => {
    if (para) {
      if (!collectOnly) {
        const st = docSt;
        const html = inline(para.join('\n'), links, st, false);
        out += tight ? html : '<p>' + html + '</p>\n';
      }
      setType('paragraph');
      para = null;
    }
  };
  while (i < n) {
    const ln = lines[i];
    const col = indentColumns(ln);
    const isLazy = lazySet ? lazySet.has(i) : false;
    if (isBlankLine(i)) {
      flushPara();
      if (lastType !== '') blankAfterBlock = true;
      i++;
      continue;
    }
    // A new block after a blank line at this level: the blocks are
    // separated, which is what makes a list loose.
    if (para === null && blankAfterBlock) { loose = true; blankAfterBlock = false; }
    const content = stripIndent(ln, 3);
    // inside a list item (the reference's state.top=false) a code-like
    // line is a code block even while a paragraph is open, and its text
    // merges into the paragraph with the indent removed; the same holds
    // for a lazy line that starts a new blockquote group
    if (para && col >= 4 && (inList || (groupStarts && groupStarts.has(i)))) {
      para.push(codeRemoveIndentLine(ln));
      i++;
      continue;
    }
    // indented code block (cannot interrupt a paragraph)
    if (col >= 4 && !para) {
      const codeLines = [];
      let j = i;
      while (j < n) {
        const l2 = lines[j];
        if (isBlankLine(j)) {
          let k = j + 1;
          while (k < n && isBlankLine(k)) k++;
          if (k < n && indentColumns(lines[k]) >= 4) { codeLines.push(stripIndent(l2, 4)); j++; continue; }
          break;
        }
        if (indentColumns(l2) >= 4) { codeLines.push(stripIndent(l2, 4)); j++; continue; }
        break;
      }
      while (codeLines.length && codeLines[codeLines.length - 1] === '') codeLines.pop();
      if (!collectOnly) {
        let code = codeLines.join('\n');
        if (code !== '') code = code.replace(/\n$/, '') + '\n';
        out += '<pre><code>' + escFull(code) + '</code></pre>\n';
      }
      setType('code');
      i = j;
      continue;
    }
    // fenced code block
    const fm = /^(`{3,}|~{3,})([^\n]*)$/.exec(content);
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
      flushPara();
      const fence = fm[1];
      const ch = fence[0];
      const flen = fence.length;
      const fenceWs = ln.match(/^[ \t]*/)[0];
      const info = fm[2].trim();
      const lang = (info.split(/\s+/)[0] || '').replace(/\\([\p{P}\p{S}])/gu, '$1');
      const codeLines = [];
      let j = i + 1;
      while (j < n) {
        const l2 = lines[j];
        const c2 = stripIndent(l2, 3);
        const cm = /^(`{3,}|~{3,})[ \t]*$/.exec(c2);
        if (cm && cm[1][0] === ch && cm[1].length >= flen) { j++; break; }
        if (ch === '`') {
          const ws = l2.match(/^[ \t]*/)[0];
          const rm = Math.min(ws.length, fenceWs.length);
          codeLines.push(l2.slice(rm));
        } else {
          codeLines.push(l2);
        }
        j++;
      }
      if (!collectOnly) {
        let code = codeLines.join('\n');
        if (code !== '') code = code.replace(/\n$/, '') + '\n';
        const langAttr = lang !== '' ? ' class="language-' + escText(lang) + '"' : '';
        out += '<pre><code' + langAttr + '>' + escFull(code) + '</code></pre>\n';
      }
      setType('code');
      i = j;
      continue;
    }
    // ATX heading
    const hm = /^(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(content);
    if (hm) {
      flushPara();
      if (!collectOnly) {
        const st = docSt;
        let text = hm[2] === undefined ? '' : hm[2].trim();
        if (/#$/.test(text)) {
          const stripped = text.replace(/#+$/, '');
          if (stripped === '' || /[ \t]$/.test(stripped)) text = stripped.trim();
        }
        out += '<h' + hm[1].length + '>' + inline(text, links, st, false) + '</h' + hm[1].length + '>\n';
      }
      setType('heading');
      i++;
      continue;
    }
    // blockquote (its inner paragraphs always get <p>: the list
    // tight/loose distinction does not propagate into a blockquote)
    if (content.startsWith('>')) {
      flushPara();
      const res = parseBlockquote(lines, i, links, false, collectOnly, undefined, docSt);
      if (!collectOnly) out += res.html;
      setType('blockquote');
      i = res.next;
      continue;
    }
    // setext heading (only when a paragraph is open, and not a lazy line);
    // a setext underline takes precedence over a thematic break
    if (para && !isLazy) {
      const sm = /^(=+|-+)[ \t]*$/.exec(content);
      if (sm) {
        const level = sm[1][0] === '=' ? 1 : 2;
        if (!collectOnly) {
          const st = docSt;
          out += '<h' + level + '>' + inline(para.join('\n').trim(), links, st, false) + '</h' + level + '>\n';
        }
        setType('heading');
        para = null;
        i++;
        continue;
      }
    }
    // thematic break
    if (/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(content)) {
      flushPara();
      if (!collectOnly) out += '<hr>\n';
      setType('hr');
      i++;
      continue;
    }
    // list (an empty first item, or an ordered list not starting at 1,
    // cannot interrupt a paragraph: the line is paragraph text instead)
    const lm = parseMarker(ln);
    // A list interrupts a paragraph only when it starts with 1 (for
    // ordered lists) -- except inside a list item, where the reference
    // tokenizes lines one at a time and any list marker interrupts.
    if (lm && (!para || (lm.content !== '' && (!lm.ordered || lm.start === 1 || inList)))) {
      flushPara();
      const res = parseList(lines, i, links, collectOnly, docSt);
      if (!collectOnly) out += res.html;
      setType('list');
      i = res.next;
      continue;
    }
    // HTML block
    const hbType = htmlBlockType(content, para !== null);
    if (hbType > 0) {
      flushPara();
      let j = i + 1;
      if (hbType <= 5) {
        if (!htmlBlockEnd(hbType, ln)) {
          while (j < n) {
            if (htmlBlockEnd(hbType, lines[j])) { j++; break; }
            j++;
          }
        }
      } else {
        while (j < n && !isBlankLine(j)) j++;
      }
      if (!collectOnly) {
        let text = lines.slice(i, j).join('\n');
        // The block's text ends with a newline only when it is followed
        // by no blank line. Types 6-7 end at a blank line, so when one
        // follows (j < n) it swallows the newline, whatever it holds
        // (empty, spaces, or tabs). Types 1-5 end at a marker: the
        // newline is kept unless the next line is truly empty.
        if (j < n) {
          if (hbType <= 5 && lines[j] !== '') text += '\n';
        } else if (src.endsWith('\n')) {
          text += '\n';
        }
        out += text;
      }
      setType('html');
      i = j;
      continue;
    }
    // table (only at a block boundary)
    if (!para) {
      const tb = tryTable(lines, i, links, collectOnly, docSt);
      if (tb) {
        if (!collectOnly) out += tb.html;
        setType('table');
        i = tb.next;
        continue;
      }
    }
    // link reference definition (only at a block boundary)
    if (!para) {
      const def = tryDef(content, lines, i);
      if (def) {
        if (!links.has(def.label)) links.set(def.label, { href: def.href, title: def.title });
        setType('def');
        i = def.next;
        continue;
      }
    }
    // paragraph text: the raw line (leading spaces preserved); a lazy
    // line that looks like indented code contributes its code text
    if (!para) para = [];
    para.push(ln);
    i++;
  }
  flushPara();
  return { html: out, lastType, firstType, loose };
}

// ---------- entry point ----------

export function parse(markdown) {
  // The reference normalises line endings first (CRLF and lone CR become
  // LF) before any lexing; without it a line ending in \r defeats the
  // block regexes (`.` does not match \r).
  markdown = markdown.replace(/\r\n?/g, '\n');
  const links = new Map();
  // First pass: collect link reference definitions for the whole document
  // (a definition after its use still resolves). The output is discarded.
  // Each pass gets a fresh inline state (inLink/inRawBlock persist across
  // blocks within a pass, as in the reference's lexer state).
  renderBlocks(markdown, links, false, true, undefined, false, undefined, { hasLink: false, inLink: false, inRawBlock: false });
  // Second pass: render with the complete definition table.
  return renderBlocks(markdown, links, false, false, undefined, false, undefined, { hasLink: false, inLink: false, inRawBlock: false }).html;
}
