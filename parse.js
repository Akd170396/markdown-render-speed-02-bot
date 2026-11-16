// Fast CommonMark 0.31.2 + GFM renderer, byte-identical to marked 18.1.3
// with its default options (gfm on, breaks off, pedantic off, async off).
// Written from scratch for the make.fun markdown-render-speed-02 contest.
// Dependency-free ES module: parse(markdown) returns the HTML string.
//
// Layout: helpers and the HTML5 named-entity table first, then the inline
// parser (single pass with a delimiter stack), then the block parser
// (container stack over lines), then rendering and the parse() entry point.

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CODE_SPACE = 32;
const CODE_TAB = 9;
const CODE_LF = 10;
const CODE_CR = 13;
const CODE_LT = 60;
const CODE_GT = 62;
const CODE_AMP = 38;
const CODE_QUOT = 34;
const CODE_APOS = 39;
const CODE_BACKSLASH = 92;
const CODE_BACKTICK = 96;
const CODE_LBRACKET = 91;
const CODE_RBRACKET = 93;
const CODE_STAR = 42;
const CODE_UNDER = 95;
const CODE_TILDE = 126;
const CODE_BANG = 33;
const CODE_HASH = 35;
const CODE_DASH = 45;
const CODE_PLUS = 43;
const CODE_DOT = 46;
const CODE_SLASH = 47;
const CODE_COLON = 58;
const CODE_SEMI = 59;
const CODE_EQ = 61;
const CODE_PIPE = 124;
const CODE_LPAREN = 40;
const CODE_RPAREN = 41;
const CODE_CARET = 94;

function isSpace(c) {
  return c === CODE_SPACE || c === CODE_TAB;
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

function isAlpha(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAlnum(c) {
  return isAlpha(c) || isDigit(c);
}

// ASCII punctuation, as CommonMark defines it (and backslash escapes use it).
function isAsciiPunct(c) {
  return (
    (c >= 33 && c <= 47) ||
    (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) ||
    (c >= 123 && c <= 126)
  );
}

function isWhitespace(c) {
  return c === CODE_SPACE || c === CODE_TAB || c === CODE_LF || c === CODE_CR;
}

// A character is Unicode whitespace (for link destination / label rules we
// only need the ASCII set plus the common Unicode spaces).
function isUnicodeSpace(c) {
  return (
    c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 ||
    c === 0x00a0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

const UNICODE_PUNCT_OR_SYMBOL = /[\p{P}\p{S}]/u;
function isPunct(c) {
  // Unicode punctuation: general categories P and S (per the CommonMark
  // definition, used only for emphasis flanking decisions).
  return UNICODE_PUNCT_OR_SYMBOL.test(String.fromCodePoint(c));
}

// Escape text for HTML: & < > " ' (marked escapes all five, in text and in
// code spans alike).
function escapeHtml(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === CODE_AMP) rep = '&amp;';
    else if (c === CODE_LT) rep = '&lt;';
    else if (c === CODE_GT) rep = '&gt;';
    else if (c === CODE_QUOT) rep = '&quot;';
    else if (c === CODE_APOS) rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// Escape for an attribute value delimited by double quotes. marked keeps
// entity-looking text in href/title verbatim, so only the quote itself (and
// a raw &) are touched here; callers pass already-cleaned values.
function escapeAttrQuote(s) {
  return s.indexOf('"') === -1 ? s : s.replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// HTML5 named character references (single-character values). Unknown names
// are left verbatim by the inline parser; only names in this table decode.
// ---------------------------------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', iexcl: '¡',
  cent: '¢', pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§',
  uml: '¨', copy: '©', ordf: 'ª', laquo: '«', not: '¬', shy: '­',
  reg: '®', macr: '¯', deg: '°', plusmn: '±', sup2: '²', sup3: '³',
  acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸', sup1: '¹',
  ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾',
  iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã',
  Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×',
  Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ouml: 'ö', divide: '÷', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  Amacr: 'Ā', amacr: 'ā', Abreve: 'Ă', abreve: 'ă', Aogon: 'Ą',
  aogon: 'ą', Cacute: 'Ć', cacute: 'ć', Ccaron: 'Č', ccaron: 'č',
  Dcaron: 'Ď', dcaron: 'ď', Emacr: 'Ē', emacr: 'ē', Edot: 'Ė',
  edot: 'ė', Eogon: 'Ę', eogon: 'ę', Ecaron: 'Ě', ecaron: 'ě',
  Gbreve: 'Ğ', gbreve: 'ğ', Gdot: 'Ġ', gdot: 'ġ', Hstrok: 'Ħ',
  hstrok: 'ħ', Idot: 'İ', Inodot: 'ı',
  Imacr: 'Ī', imacr: 'ī', Iogon: 'Į', iogon: 'į', Lacute: 'Ĺ',
  lacute: 'ĺ', Lcaron: 'Ľ', lcaron: 'ľ', Lmidot: 'Ŀ', lmidot: 'ŀ',
  Lstrok: 'Ł', lstrok: 'ł', Nacute: 'Ń', nacute: 'ń', Ncaron: 'Ň',
  ncaron: 'ň', Ncedil: 'Ņ', ncedil: 'ņ', napos: 'ŉ', Omacr: 'Ō',
  omacr: 'ō', Odblac: 'Ő', odblac: 'ő',
  OElig: 'Œ', oelig: 'œ', Racute: 'Ŕ', racute: 'ŕ', Rcaron: 'Ř',
  rcaron: 'ř', Rcedil: 'Ŗ', rcedil: 'ŗ', Sacute: 'Ś', sacute: 'ś',
  Scirc: 'Ŝ', scirc: 'ŝ', Scedil: 'Ş', scedil: 'ş', Scaron: 'Š',
  scaron: 'š', Tcaron: 'Ť', tcaron: 'ť', Tcedil: 'Ţ', tcedil: 'ţ',
  Tstrok: 'Ŧ', tstrok: 'ŧ', Umacr: 'Ū', umacr: 'ū', Ubreve: 'Ŭ',
  ubreve: 'ŭ', Uring: 'Ů', uring: 'ů', Udblac: 'Ű', udblac: 'ű',
  Uogon: 'Ų', uogon: 'ų', Ycirc: 'Ŷ', ycirc: 'ŷ', Yuml: 'Ÿ',
  Zacute: 'Ź', zacute: 'ź', Zdot: 'Ż', zdot: 'ż', Zcaron: 'Ž',
  zcaron: 'ž', fnof: 'ƒ', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ',
  Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ',
  Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ',
  Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ',
  Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π',
  rho: 'ρ', sigmaf: 'ς', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', thetasym: 'ϑ',
  upsih: 'ϒ', piv: 'ϖ', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', ndash: '–',
  mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“',
  rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  lsaquo: '‹', rsaquo: '›', euro: '€', bull: '•', hellip: '…',
  prime: '′', Prime: '″', oline: '‾', frasl: '⁄', weierp: '℘',
  image: 'ℑ', real: 'ℜ', trade: '™', alefsym: 'ℵ', larr: '←',
  uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵',
  lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
  forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇',
  isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑',
  minus: '−', lowast: '∗', radic: '√', prop: '∝', infin: '∞',
  ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫',
  there4: '∴', sim: '∼', cong: '≅', asymp: '≈', ne: '≠',
  equiv: '≡', le: '≤', ge: '≥', sub: '⊂', sup: '⊃', nsub: '⊄',
  sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥',
  sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
  lang: '〈', rang: '〉', loz: '◊', spades: '♠', clubs: '♣',
  hearts: '♥', diams: '♦', circ: 'ˆ', tilde: '˜', Dstrok: 'Đ',
  dstrok: 'đ', eng: 'ŋ', ENG: 'Ŋ', horbar: '―', vellip: '⋮',
  sung: '♪', flat: '♭', natur: '♮', sharp: '♯',
};

// ---------------------------------------------------------------------------
// URL handling (marked's cleanUrl behaviour, as its outputs show it)
// ---------------------------------------------------------------------------

function cleanUrl(href) {
  // Block obfuscated dangerous schemes: decode entities and percent escapes
  // in a scratch copy, strip everything but word characters and colons, and
  // look at the scheme.
  let probe = '';
  for (let i = 0; i < href.length; i++) {
    const c = href.charCodeAt(i);
    if (c === CODE_AMP) {
      const e = decodeEntityAt(href, i);
      if (e !== null) {
        probe += e.ch;
        i = e.end - 1;
        continue;
      }
    }
    if (c === 37 && i + 2 < href.length) {
      const h1 = href.charCodeAt(i + 1);
      const h2 = href.charCodeAt(i + 2);
      const v1 = hexVal(h1);
      const v2 = hexVal(h2);
      if (v1 >= 0 && v2 >= 0) {
        probe += String.fromCharCode(v1 * 16 + v2);
        i += 2;
        continue;
      }
    }
    probe += href[i];
  }
  const scheme = probe.replace(/[^\w:]/g, '').toLowerCase();
  if (
    scheme.startsWith('javascript:') ||
    scheme.startsWith('vbscript:') ||
    scheme.startsWith('data:')
  ) {
    return null;
  }
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

// Escape an attribute value: < > " ' always, & unless it starts something
// that looks like a character reference (&name; / &#123; / &#x1f;).
function escapeAttr(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === CODE_LT) rep = '&lt;';
    else if (c === CODE_GT) rep = '&gt;';
    else if (c === CODE_QUOT) rep = '&quot;';
    else if (c === CODE_APOS) rep = '&#39;';
    else if (c === CODE_AMP) {
      let j = i + 1;
      if (s.charCodeAt(j) === CODE_HASH) j++;
      let k = j;
      while (k < s.length && isAlnum(s.charCodeAt(k))) k++;
      if (k > j && k < s.length && s.charCodeAt(k) === CODE_SEMI) {
        continue;
      }
      rep = '&amp;';
    }
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// ---------------------------------------------------------------------------
// Character references
// ---------------------------------------------------------------------------

// At s[i] === '&': try to read a character reference. Returns
// { ch, end } where ch is the (already HTML-escaped) replacement text and
// end is the index just past the reference, or null when the & is not part
// of a reference at all (caller escapes it as &amp;). An unknown named
// reference is returned verbatim, exactly as written.
function decodeEntityAt(s, i, rawNamed = false) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c1 = s.charCodeAt(i + 1);
  if (c1 === CODE_HASH) {
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) {
      hex = true;
      j++;
    }
    const ds = j;
    let val = 0;
    let digits = 0;
    while (j < n) {
      const v = hexVal(s.charCodeAt(j));
      if (v < 0 || (!hex && v > 9)) break;
      val = val * (hex ? 16 : 10) + v;
      if (val > 0x10ffff) return null;
      digits++;
      j++;
    }
    if (digits === 0 || j >= n || s.charCodeAt(j) !== CODE_SEMI) return null;
    let ch;
    if (val === 0 || (val >= 0xd800 && val <= 0xdfff)) {
      ch = '�';
    } else {
      ch = String.fromCodePoint(val);
    }
    return { ch: escapeHtml(ch), end: j + 1 };
  }
  if (!isAlnum(c1)) return null;
  let j = i + 1;
  while (j < n && isAlnum(s.charCodeAt(j))) j++;
  if (j >= n || s.charCodeAt(j) !== CODE_SEMI) return null;
  const name = s.slice(i + 1, j);
  // In text, a named reference is passed through verbatim (the output
  // keeps &copy; as &copy;); only the URL probe decodes it, so an
  // obfuscated scheme is still detected.
  if (rawNamed) {
    return { ch: s.slice(i, j + 1), end: j + 1 };
  }
  if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) {
    return { ch: escapeHtml(ENTITIES[name]), end: j + 1 };
  }
  return { ch: s.slice(i, j + 1), end: j + 1 };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

// Token kinds: 0 = text (final HTML), 1 = emphasis delimiter run,
// 2 = link/image opener marker (its text token is a sibling; the marker
// only lives on the link stack).
let inlineSeq = 0;

function textTok(s) {
  return { k: 0, s, seq: inlineSeq++ };
}

function delimTok(ch, n, open, close) {
  return { k: 1, ch, n, s: ch.repeat(n), open, close, seq: inlineSeq++, usedL: 0, usedR: 0, leftTags: [], rightTags: [], dead: false };
}

// Reference label normalization: trim, collapse whitespace, case-fold.
// JavaScript's toLowerCase maps ẞ to ß, but Unicode case folding maps it
// to "ss", and several ligatures fold to their expansions, so apply those
// after lowercasing.
function normalizeLabel(s) {
  let out = '';
  let inSpace = true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isUnicodeSpace(c)) {
      if (!inSpace) {
        out += ' ';
        inSpace = true;
      }
    } else {
      out += s[i].toLowerCase();
      inSpace = false;
    }
  }
  if (out.endsWith(' ')) out = out.slice(0, -1);
  return out
    .replace(/ß/g, 'ss')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/ﬅ/g, 'st')
    .replace(/ﬆ/g, 'st');
}

function stripTags(html) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    // An <img> tag contributes its alt text to the plain text.
    const tag = html.slice(lt, gt + 1);
    if (/^<img[\s>]/i.test(tag)) {
      const m = tag.match(/alt\s*=\s*"([^"]*)"|alt\s*=\s*'([^']*)'|alt\s*=\s*([^\s>]+)/i);
      if (m) out += m[1] ?? m[2] ?? m[3] ?? '';
    }
    i = gt + 1;
  }
  return out;
}

// Process backslash escapes inside a link destination or title: \ + ASCII
// punctuation becomes the punctuation itself.
function unescapeStr(s) {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === CODE_BACKSLASH && i + 1 < s.length && isAsciiPunct(s.charCodeAt(i + 1))) {
      if (i > start) out += s.slice(start, i);
      out += s[i + 1];
      i++;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

function skipWs(s, i) {
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  return i;
}

function skipWsNl(s, i) {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === CODE_SPACE || c === CODE_TAB || c === CODE_LF) i++;
    else break;
  }
  return i;
}

// Scan a link label starting at s[j] (just after '['). Returns the index
// of the first unescaped ']', or -1 if the label is invalid (it contains
// an unescaped '[') or unterminated.
function scanLabelEnd(s, j) {
  const n = s.length;
  let k = j;
  while (k < n) {
    const c = s.charCodeAt(k);
    if (c === CODE_BACKSLASH && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) {
      k += 2;
      continue;
    }
    if (c === CODE_LBRACKET) return -1;
    if (c === CODE_RBRACKET) return k;
    k++;
  }
  return -1;
}

// Does the text contain an unescaped '['?
function hasUnescapedBracket(text) {
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c === CODE_BACKSLASH && k + 1 < text.length && isAsciiPunct(text.charCodeAt(k + 1))) {
      k++;
      continue;
    }
    if (c === CODE_LBRACKET) return true;
  }
  return false;
}

// Are the brackets in the text balanced? Escaped brackets and brackets
// inside code spans do not count.
function bracketsBalanced(text) {
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c === CODE_BACKSLASH && k + 1 < text.length && isAsciiPunct(text.charCodeAt(k + 1))) {
      k++;
      continue;
    }
    if (c === CODE_BACKTICK) {
      let run = 0;
      while (k + run < text.length && text.charCodeAt(k + run) === CODE_BACKTICK) run++;
      let m = k + run;
      let close = -1;
      while (m < text.length) {
        if (text.charCodeAt(m) === CODE_BACKTICK) {
          let r2 = 0;
          while (m + r2 < text.length && text.charCodeAt(m + r2) === CODE_BACKTICK) r2++;
          if (r2 === run) {
            close = m;
            break;
          }
          m += r2;
        } else {
          m++;
        }
      }
      if (close !== -1) {
        k = close + run - 1;
        continue;
      }
      k += run - 1;
      continue;
    }
    if (c === CODE_LBRACKET) depth++;
    else if (c === CODE_RBRACKET) {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// Try to parse an inline link suffix (dest "title") starting at s[i]
// (the '('). Returns { href, title, end } or null.
function tryInlineLinkSuffix(s, i) {
  const n = s.length;
  {
    let j = skipWsNl(s, i + 1);
    let href = '';
    let hasDest = false;
    if (j < n && s.charCodeAt(j) === CODE_RPAREN) {
      return { href: '', title: null, end: j + 1 };
    }
    if (j < n && s.charCodeAt(j) === CODE_LT) {
      // <...> destination: no line endings, no unescaped < or >.
      let k = j + 1;
      let ok = false;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === CODE_BACKSLASH && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) {
          k += 2;
          continue;
        }
        if (c === CODE_LT || c === CODE_LF) break;
        if (c === CODE_GT) {
          ok = true;
          break;
        }
        k++;
      }
      if (!ok) return null;
      href = unescapeStr(s.slice(j + 1, k));
      hasDest = true;
      j = k + 1;
    } else {
      // Bare destination: no spaces or control chars, parens balanced.
      let k = j;
      let depth = 0;
      let end = -1;
      let closed = false;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === CODE_BACKSLASH && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) {
          k += 2;
          continue;
        }
        if (c === CODE_LPAREN) {
          depth++;
        } else if (c === CODE_RPAREN) {
          if (depth === 0) {
            end = k;
            closed = true;
            break;
          }
          depth--;
        } else if (c <= 32 || c === 127) {
          end = k;
          break;
        }
        k++;
      }
      if (end === -1) return null;
      href = unescapeStr(s.slice(j, end));
      hasDest = true;
      j = end;
      if (closed) {
        const cleaned = cleanUrl(href);
        if (cleaned === null) return null;
        return { href: cleaned, title: null, end: j + 1 };
      }
    }
    if (!hasDest) return null;
    j = skipWsNl(s, j);
    let title = null;
    if (j < n && s.charCodeAt(j) === CODE_RPAREN) {
      const cleaned = cleanUrl(href);
      if (cleaned === null) return null;
      return { href: cleaned, title: null, end: j + 1 };
    }
    if (j < n) {
      const q = s.charCodeAt(j);
      if (q === CODE_QUOT || q === CODE_APOS) {
        let k = j + 1;
        let ok = false;
        while (k < n) {
          const c = s.charCodeAt(k);
          if (c === CODE_BACKSLASH && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) {
            k += 2;
            continue;
          }
          if (c === q) {
            ok = true;
            break;
          }
          k++;
        }
        if (!ok) return null;
        title = unescapeStr(s.slice(j + 1, k));
        j = skipWsNl(s, k + 1);
      } else if (q === CODE_LPAREN) {
        let k = j + 1;
        let ok = false;
        while (k < n) {
          const c = s.charCodeAt(k);
          if (c === CODE_BACKSLASH && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) {
            k += 2;
            continue;
          }
          if (c === CODE_RPAREN) {
            ok = true;
            break;
          }
          k++;
        }
        if (!ok) return null;
        title = unescapeStr(s.slice(j + 1, k));
        j = skipWsNl(s, k + 1);
      }
    }
    if (j < n && s.charCodeAt(j) === CODE_RPAREN) {
      const cleaned = cleanUrl(href);
      if (cleaned === null) return null;
      return { href: cleaned, title, end: j + 1 };
    }
    return null;
  }
}

// Try to parse a link suffix starting at s[i] (just past the closing ]).
// Returns { href, title, end } or null. href is the cleaned URL (or '' for
// an empty destination); title is the raw title text or null.
function tryLinkSuffix(s, i, refs, rawText) {
  const n = s.length;
  if (i < n && s.charCodeAt(i) === CODE_LPAREN) {
    // Inline form; if it is malformed, fall through to the shortcut form.
    const inline = tryInlineLinkSuffix(s, i);
    if (inline !== null) return inline;
  } else if (i < n && s.charCodeAt(i) === CODE_LBRACKET) {
    // [label] reference link (or [] collapsing to the link text). A
    // [label] form that fails does not fall back to the shortcut form.
    const labelEnd = scanLabelEnd(s, i + 1);
    if (labelEnd === -1) return null;
    const labelRaw = s.slice(i + 1, labelEnd);
    const label = labelRaw === '' ? normalizeLabel(rawText) : normalizeLabel(labelRaw);
    if (label.length > 999) return null;
    const ref = refs.get(label);
    if (!ref || ref.href === null) return null;
    return { href: ref.href, title: ref.title, end: labelEnd + 1 };
  }
  // Shortcut reference link: the label is the link text, which must not
  // contain an unescaped '['.
  if (hasUnescapedBracket(rawText)) return null;
  const label = normalizeLabel(rawText);
  if (label.length === 0 || label.length > 999) return null;
  const ref = refs.get(label);
  if (!ref || ref.href === null) return null;
  return { href: ref.href, title: ref.title, end: i };
}

// Flanking for a delimiter run starting at s[i] with length n. A missing
// neighbour (start/end of string) counts as whitespace.
function flanking(s, i, n) {
  const before = i > 0 ? s.charCodeAt(i - 1) : -1;
  const after = i + n < s.length ? s.charCodeAt(i + n) : -1;
  const beforeSpace = before === -1 || isUnicodeSpace(before);
  const afterSpace = after === -1 || isUnicodeSpace(after);
  const beforePunct = before !== -1 && isPunct(before);
  const afterPunct = after !== -1 && isPunct(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  return { left, right, beforePunct, afterPunct };
}

// Resolve emphasis/del delimiters in `delims` (delimiter tokens, in token
// order). A token used as an opener loses characters from its right end
// (opening tags are recorded in reverse match order) and as a closer from
// its left end (closing tags in match order); leftovers stay literal.
function resolveEmphasis(delims) {
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (!closer.close || closer.dead) continue;
    while (closer.n - closer.usedL - closer.usedR > 0) {
      let opener = null;
      let openerIdx = -1;
      for (let oi = ci - 1; oi >= 0; oi--) {
        const o = delims[oi];
        if (o.ch !== closer.ch || !o.open || o.dead) continue;
        if (o.n - o.usedL - o.usedR <= 0) continue;
        if (closer.ch !== '~') {
          const oRem = o.n - o.usedL - o.usedR;
          const cRem = closer.n - closer.usedL - closer.usedR;
          if (
            ((o.open && o.close) || (closer.open && closer.close)) &&
            (oRem + cRem) % 3 === 0 &&
            !(oRem % 3 === 0 && cRem % 3 === 0)
          ) {
            continue;
          }
          // A single closer must not steal the last asterisk of a double
          // opener when a later double closer could take the whole pair
          // (otherwise the strong span is broken into nested <em>).
          // A triple opener can spare one (it still has two left).
          if (cRem === 1 && oRem === 2) {
            let laterStrong = false;
            for (let k = ci + 1; k < delims.length; k++) {
              const lk = delims[k];
              if (lk.ch !== closer.ch || !lk.close || lk.dead) continue;
              if (lk.n - lk.usedL - lk.usedR >= 2) { laterStrong = true; break; }
            }
            if (laterStrong) continue;
          }
        }
        opener = o;
        openerIdx = oi;
        break;
      }
      if (opener === null) break;
      let use;
      if (closer.ch === '~') {
        // One tilde matches one, two match two; the shorter side wins.
        const oRem = opener.n - opener.usedL - opener.usedR;
        const cRem = closer.n - closer.usedL - closer.usedR;
        use = Math.min(oRem, cRem);
        if (use === 0) break;
      } else {
        const oRem = opener.n - opener.usedL - opener.usedR;
        const cRem = closer.n - closer.usedL - closer.usedR;
        use = oRem >= 2 && cRem >= 2 ? 2 : 1;
      }
      // A tilde delimiter is always <del>, whether one or two tildes
      // matched; * and _ use <em> for one, <strong> for two.
      const openTag = closer.ch === '~' ? '<del>' : use === 2 ? '<strong>' : '<em>';
      const closeTag = closer.ch === '~' ? '</del>' : use === 2 ? '</strong>' : '</em>';
      opener.usedR += use;
      opener.rightTags.unshift(openTag);
      closer.usedL += use;
      closer.leftTags.push(closeTag);
      // Delimiters inside the span just formed can no longer match
      // anything outside it: the span's boundary blocks them.
      for (let di = openerIdx + 1; di < ci; di++) delims[di].dead = true;
      if (closer.n - closer.usedL - closer.usedR <= 0) break;
    }
  }
}

function expandTok(tok) {
  if (tok.k === 0) return tok.s;
  const leftover = tok.n - tok.usedL - tok.usedR;
  return tok.leftTags.join('') + (leftover > 0 ? tok.ch.repeat(leftover) : '') + tok.rightTags.join('');
}

// Try an autolink <scheme:...> or <email> at s[i] === '<'. Returns
// { html, end } or null.
function tryAngleAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  if (j >= n) return null;
  const c = s.charCodeAt(j);
  if (!isAlpha(c)) return null;
  // Scheme: letter followed by letters/digits/+/-/. (2-32 chars), then ':'.
  let k = j;
  while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 43 || s.charCodeAt(k) === 45 || s.charCodeAt(k) === 46)) k++;
  if (k - j >= 2 && k - j <= 32 && k < n && s.charCodeAt(k) === CODE_COLON) {
    let e = k + 1;
    while (e < n) {
      const cc = s.charCodeAt(e);
      if (cc === CODE_GT) {
        const raw = s.slice(i + 1, e);
        const href = escapeAttr(cleanUrl(raw) ?? raw);
        return { html: `<a href="${href}">${escapeAttr(raw)}</a>`, end: e + 1 };
      }
      if (cc <= 32 || cc === CODE_LT) return null;
      e++;
    }
    return null;
  }
  // Email: local@domain, domain labels without a required dot.
  let at = -1;
  k = j;
  while (k < n) {
    const cc = s.charCodeAt(k);
    if (cc === CODE_GT) break;
    if (cc <= 32 || cc === CODE_LT || cc === CODE_COLON) return null;
    if (cc === 64) {
      if (at !== -1) return null;
      at = k;
    }
    k++;
  }
  if (at === -1 || k >= n || s.charCodeAt(k) !== CODE_GT) return null;
  const local = s.slice(j, at);
  const domain = s.slice(at + 1, k);
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(domain)) return null;
  const raw = s.slice(i + 1, k);
  return { html: `<a href="mailto:${escapeAttr(raw)}">${escapeAttr(raw)}</a>`, end: k + 1 };
}

// Try an inline HTML construct at s[i] === '<'. Returns the verbatim tag
// and its end, or null.
function tryHtmlTag(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    // <!--> and <!---> are complete (empty) comments on their own; they
    // do not swallow a later --> as their closer.
    if (s.startsWith('<!-->', i)) return { html: '<!-->', end: i + 5 };
    if (s.startsWith('<!--->', i)) return { html: '<!--->', end: i + 6 };
    const e = s.indexOf('-->', i + 4);
    if (e === -1) return null;
    return { html: s.slice(i, e + 3), end: e + 3 };
  }
  if (s.startsWith('<?', i)) {
    const e = s.indexOf('?>', i + 2);
    if (e === -1) return null;
    return { html: s.slice(i, e + 2), end: e + 2 };
  }
  if (s.startsWith('<![CDATA[', i)) {
    const e = s.indexOf(']]>', i + 9);
    if (e === -1) return null;
    return { html: s.slice(i, e + 3), end: e + 3 };
  }
  if (s.startsWith('<!', i)) {
    if (i + 2 < n && isAlpha(s.charCodeAt(i + 2))) {
      const e = s.indexOf('>', i + 2);
      if (e === -1) return null;
      return { html: s.slice(i, e + 1), end: e + 1 };
    }
    return null;
  }
  let j = i + 1;
  let closing = false;
  if (j < n && s.charCodeAt(j) === CODE_SLASH) {
    closing = true;
    j++;
  }
  if (j >= n || !isAlpha(s.charCodeAt(j))) return null;
  const nameStart = j;
  while (j < n) {
    const cc = s.charCodeAt(j);
    if (isAlnum(cc) || cc === CODE_DASH) j++;
    else break;
  }
  if (j === nameStart) return null;
  if (closing) {
    let k = j;
    while (k < n && isWhitespace(s.charCodeAt(k))) k++;
    if (k < n && s.charCodeAt(k) === CODE_GT) {
      return { html: s.slice(i, k + 1), end: k + 1 };
    }
    return null;
  }
  // Open tag: attributes, then > or />. Whitespace inside a tag includes
  // line endings, so attributes may span lines. Whitespace is required
  // between the tag name and the first attribute, and after a valued
  // attribute before the next one; after a valueless attribute the
  // separator whitespace was already consumed while looking for '=',
  // so the next attribute may start at once.
  let k = j;
  let needWs = true;
  while (k < n) {
    const cc = s.charCodeAt(k);
    if (cc === CODE_GT) {
      return { html: s.slice(i, k + 1), end: k + 1 };
    }
    if (cc === CODE_SLASH && k + 1 < n && s.charCodeAt(k + 1) === CODE_GT) {
      return { html: s.slice(i, k + 2), end: k + 2 };
    }
    if (needWs && !isWhitespace(cc)) return null;
    if (isWhitespace(cc)) {
      k = skipWsNl(s, k);
      if (k >= n) return null;
      if (s.charCodeAt(k) === CODE_GT) {
        return { html: s.slice(i, k + 1), end: k + 1 };
      }
      if (s.charCodeAt(k) === CODE_SLASH && k + 1 < n && s.charCodeAt(k + 1) === CODE_GT) {
        return { html: s.slice(i, k + 2), end: k + 2 };
      }
    }
    needWs = false;
    // Attribute name.
    const an = s.charCodeAt(k);
    if (!(isAlpha(an) || an === CODE_UNDER || an === CODE_COLON)) return null;
    k++;
    while (k < n) {
      const ac = s.charCodeAt(k);
      if (isAlnum(ac) || ac === CODE_UNDER || ac === CODE_COLON || ac === CODE_DOT || ac === CODE_DASH) k++;
      else break;
    }
    k = skipWsNl(s, k);
    if (k < n && s.charCodeAt(k) === CODE_EQ) {
      k++;
      k = skipWsNl(s, k);
      if (k >= n) return null;
      const q = s.charCodeAt(k);
      if (q === CODE_QUOT || q === CODE_APOS) {
        const e = s.indexOf(String.fromCharCode(q), k + 1);
        if (e === -1) return null;
        k = e + 1;
      } else {
        const vs = k;
        while (k < n) {
          const vc = s.charCodeAt(k);
          if (isWhitespace(vc) || vc === CODE_QUOT || vc === CODE_APOS || vc === CODE_EQ || vc === CODE_LT || vc === CODE_GT || vc === CODE_BACKTICK) break;
          k++;
        }
        if (k === vs) return null;
      }
      // After a value, whitespace is required before the next attribute.
      needWs = true;
    }
  }
  return null;
}

const EXT_PREV_OK = new Set([40, 91, 123, 60, 62, 34, 39, 42, 95, 126, 96, 59, 58, 44, 33, 63, 61, 124, 94, 36, 92]);

// Match a GFM extended autolink at s[i]. Returns { html, end } or null.
// Kinds: www. domain, scheme:// URL, scheme: email/domain (one path
// segment), bare email.
function tryExtendedAutolink(s, i) {
  const n = s.length;
  if (i > 0) {
    const prev = s.charCodeAt(i - 1);
    if (!isWhitespace(prev) && !EXT_PREV_OK.has(prev)) return null;
  }
  const isWww = s.startsWith('www.', i);
  let schemeEnd = -1;
  let scheme = '';
  if (!isWww) {
    // Scheme: 2-32 chars, letter first.
    if (!isAlpha(s.charCodeAt(i))) {
      return tryBareEmail(s, i);
    }
    let k = i;
    while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 43 || s.charCodeAt(k) === 45 || s.charCodeAt(k) === 46)) k++;
    if (k - i < 2 || k - i > 32 || k >= n || s.charCodeAt(k) !== CODE_COLON) {
      return tryBareEmail(s, i);
    }
    scheme = s.slice(i, k);
    schemeEnd = k;
  }
  if (isWww) {
    // www. domain, then an optional path. A bare domain with no path is
    // still a link.
    const host = matchDomain(s, i + 4, true);
    if (host === null) return tryBareEmail(s, i);
    const pathEnd = scanUrlPath(s, host.end);
    const end = trimUrlEnd(s, i, pathEnd);
    if (end < host.end) return null;
    const raw = s.slice(i, end);
    const href = escapeAttr(cleanUrl(`http://${raw}`) ?? `http://${raw}`);
    return { html: `<a href="${href}">${escapeAttr(raw)}</a>`, end };
  }
  if (s.startsWith('//', schemeEnd + 1)) {
    // scheme:// full URL. A bare domain with no path is still a link.
    const host = matchDomain(s, schemeEnd + 3, false);
    if (host === null) return tryBareEmail(s, i);
    const pathEnd = scanUrlPath(s, host.end);
    const end = trimUrlEnd(s, i, pathEnd);
    if (end < host.end) return null;
    const raw = s.slice(i, end);
    const href = escapeAttr(cleanUrl(raw) ?? raw);
    return { html: `<a href="${href}">${escapeAttr(raw)}</a>`, end };
  } else {
    // scheme: token (email-like or domain) plus at most one /segment.
    const first = matchSchemeToken(s, schemeEnd + 1);
    if (first === null) return tryBareEmail(s, i);
    // A token that ends in '-' or '_' is not a valid email/domain end,
    // so the whole scheme:token is not a link.
    const tokLast = s.charCodeAt(first.end - 1);
    if (tokLast === CODE_DASH || tokLast === CODE_UNDER) return null;
    let end = first.end;
    if (end < n && s.charCodeAt(end) === CODE_SLASH) {
      const seg = scanPathSegment(s, end + 1);
      if (seg > end + 1) end = seg;
    }
    end = trimUrlEnd(s, schemeEnd + 1, end);
    // A bare scheme:token (mailto:foo@bar.baz, xmpp:foo@bar.baz) is a
    // link even with no path segment; only reject if the trim ate the
    // whole token.
    if (end <= schemeEnd + 1) return null;
    const raw = s.slice(i, end);
    const href = escapeAttr(cleanUrl(raw) ?? raw);
    return { html: `<a href="${href}">${escapeAttr(raw)}</a>`, end };
  }
}

// Domain starting at s[i]: labels of [A-Za-z0-9-]+, not starting or ending
// with '-', separated by '.'. requireDot: at least one dot must occur.
// Returns { end } (end just past the domain) or null.
function matchDomain(s, i, requireDot) {
  const n = s.length;
  let j = i;
  let labels = 0;
  let sawDot = false;
  while (j < n) {
    const ls = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (isAlnum(c) || c === CODE_DASH) j++;
      else break;
    }
    if (j === ls) return null;
    const label = s.slice(ls, j);
    if (label.startsWith('-') || label.endsWith('-')) {
      // Back off trailing dashes: the domain ends before them.
      let e = j;
      while (e > ls && s.charCodeAt(e - 1) === CODE_DASH) e--;
      if (e === ls) return null;
      return { end: e };
    }
    labels++;
    if (j < n && s.charCodeAt(j) === CODE_DOT) {
      sawDot = true;
      j++;
      if (j >= n || !(isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === CODE_DASH)) {
        return labels >= 1 && (!requireDot || sawDot) ? { end: j - 1 } : null;
      }
      continue;
    }
    break;
  }
  if (labels === 0) return null;
  if (requireDot && !sawDot) return null;
  return { end: j };
}

// The token after scheme: (no //): up to the first '/', whitespace, '<',
// '>' or '"'. Must look like an email or a domain (contain @ or a dot).
function matchSchemeToken(s, i) {
  const n = s.length;
  let j = i;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c <= 32 || c === CODE_LT || c === CODE_GT || c === CODE_QUOT || c === CODE_SLASH) break;
    j++;
  }
  if (j === i) return null;
  const tok = s.slice(i, j);
  if (tok.indexOf('@') === -1 && tok.indexOf('.') === -1) return null;
  return { end: j };
}

// One path segment after a '/': chars up to '/', whitespace, '<', '>', '"'.
function scanPathSegment(s, i) {
  const n = s.length;
  let j = i;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c <= 32 || c === CODE_LT || c === CODE_GT || c === CODE_QUOT || c === CODE_SLASH || c === CODE_RBRACKET) break;
    j++;
  }
  return j;
}

// The path (and query) after a domain in a scheme:// or www. URL: chars up
// to whitespace, '<', '>', '"' or ']'.
function scanUrlPath(s, i) {
  const n = s.length;
  let j = i;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c <= 32 || c === CODE_LT || c === CODE_GT || c === CODE_QUOT || c === CODE_RBRACKET) break;
    j++;
  }
  return j;
}

// Trim trailing punctuation from a URL candidate s[start..end): trailing
// ? ! . , : ; and ')' while parens would be unbalanced. Returns the new end.
function trimUrlEnd(s, start, end) {
  let e = end;
  while (e > start) {
    const c = s.charCodeAt(e - 1);
    if (c === 59) {
      // A trailing ';' that belongs to an entity reference stays only
      // if the reference is valid; otherwise the whole '&...;' is cut
      // from the URL (the text after the link keeps it verbatim).
      let p = -1;
      for (let k = e - 2; k >= start; k--) {
        const cc = s.charCodeAt(k);
        if (cc === 38) {
          p = k;
          break;
        }
        if (!(isAlnum(cc) || cc === 35)) break;
      }
      if (p >= 0) {
        const name = s.slice(p + 1, e - 1);
        let valid = false;
        if (name.startsWith('#')) {
          const rest = name.slice(1);
          const hex = rest.startsWith('x') || rest.startsWith('X');
          const digits = hex ? rest.slice(1) : rest;
          valid = digits.length > 0 && [...digits].every((d) => hex ? hexVal(d.charCodeAt(0)) >= 0 : d >= '0' && d <= '9');
        } else if (name.length > 0) {
          valid = Object.prototype.hasOwnProperty.call(ENTITIES, name);
        }
        if (!valid) {
          e = p;
          continue;
        }
      }
      e--;
      continue;
    }
    // Trailing *, _, ~ are emphasis markers, not part of the URL.
    if (c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 42 || c === 95 || c === 126) {
      e--;
      continue;
    }
    if (c === CODE_RPAREN) {
      let open = 0;
      let close = 0;
      for (let k = start; k < e; k++) {
        if (s.charCodeAt(k) === CODE_LPAREN) open++;
        else if (s.charCodeAt(k) === CODE_RPAREN) close++;
      }
      if (close > open) {
        e--;
        continue;
      }
    }
    break;
  }
  return e;
}

// Bare email autolink at s[i]: local@domain, domain with at least one dot.
function tryBareEmail(s, i) {
  const n = s.length;
  const c = s.charCodeAt(i);
  if (!(isAlnum(c) || c === 46 || c === 45 || c === 95)) return null;
  let j = i;
  while (j < n) {
    const cc = s.charCodeAt(j);
    if (isAlnum(cc) || cc === 46 || cc === 33 || cc === 35 || cc === 36 || cc === 37 || cc === 38 || cc === 39 || cc === 42 || cc === 43 || cc === 47 || cc === 61 || cc === 63 || cc === 94 || cc === 96 || cc === 123 || cc === 124 || cc === 125 || cc === 126 || cc === 45 || cc === 95) {
      j++;
    } else break;
  }
  if (j === i) return null;
  if (j >= n || s.charCodeAt(j) !== 64) return null;
  const local = s.slice(i, j);
  if (local.startsWith('.') || local.endsWith('.')) return null;
  const dom = matchDomain(s, j + 1, true);
  if (dom === null) return null;
  const after = dom.end < n ? s.charCodeAt(dom.end) : -1;
  // A trailing run of - or _ blocks the autolink when it joins a longer
  // word (foo@bar.baz_qux) or ends the line (a.b-c_d@a.b_); but a run
  // closing emphasis (a lone _ or __), followed on the same line by a
  // space, is punctuation, not part of the address.
  if (after === CODE_DASH || after === CODE_UNDER) {
    let k = dom.end;
    while (k < n && (s.charCodeAt(k) === CODE_DASH || s.charCodeAt(k) === CODE_UNDER)) k++;
    const afterRun = k < n ? s.charCodeAt(k) : -1;
    if (isAlnum(afterRun)) return null;
    if (afterRun === -1 || afterRun === 10) return null;
    if (afterRun !== CODE_SPACE && afterRun !== CODE_TAB) return null;
  }
  const raw = s.slice(i, dom.end);
  const href = `mailto:${escapeAttr(raw)}`;
  return { html: `<a href="${href}">${escapeAttr(raw)}</a>`, end: dom.end };
}

// Parse inline content to HTML. refs maps normalized link labels to
// { href, title }. Link text is parsed in its own scope: emphasis inside a
// link is resolved when the link forms, and [ openers inside it die with it.
function parseInline(s, refs) {
  const tokens = [];
  const delims = [];
  const linkStack = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      tokens.push(textTok(buf));
      buf = '';
    }
  };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === CODE_BACKSLASH) {
      if (i + 1 < n && s.charCodeAt(i + 1) === CODE_LF) {
        flush();
        tokens.push(textTok('<br>'));
        i += 2;
        // A hard break swallows the next line's leading indent.
        while (i < n && (s.charCodeAt(i) === CODE_SPACE || s.charCodeAt(i) === CODE_TAB)) i++;
        continue;
      }
      if (i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) {
        buf += escapeHtml(s[i + 1]);
        i += 2;
        continue;
      }
      buf += '\\';
      i++;
      continue;
    }
    if (c === CODE_BACKTICK) {
      let j = i;
      while (j < n && s.charCodeAt(j) === CODE_BACKTICK) j++;
      const run = j - i;
      let k = j;
      let close = -1;
      while (k < n) {
        if (s.charCodeAt(k) === CODE_BACKTICK) {
          let m = k;
          while (m < n && s.charCodeAt(m) === CODE_BACKTICK) m++;
          if (m - k === run) {
            close = k;
            break;
          }
          k = m;
        } else {
          k++;
        }
      }
      if (close === -1) {
        buf += '`'.repeat(run);
        i = j;
        continue;
      }
      let content = s.slice(j, close);
      if (content.indexOf('\n') !== -1) content = content.replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      flush();
      tokens.push(textTok(`<code>${escapeHtml(content)}</code>`));
      i = close + run;
      continue;
    }
    if (c === CODE_LBRACKET || (c === CODE_BANG && i + 1 < n && s.charCodeAt(i + 1) === CODE_LBRACKET)) {
      const img = c === CODE_BANG;
      flush();
      const tok = textTok(img ? '![' : '[');
      tokens.push(tok);
      linkStack.push({ tok, img, srcPos: i, seq: tok.seq, active: true });
      i += img ? 2 : 1;
      continue;
    }
    if (c === CODE_RBRACKET) {
      let opener = null;
      for (let k = linkStack.length - 1; k >= 0; k--) {
        if (linkStack[k].active) {
          opener = linkStack[k];
          break;
        }
      }
      if (opener !== null) {
        // Flush the text between the opener and this bracket into tokens
        // so it becomes the link's inner content.
        flush();
        const rawText = s.slice(opener.srcPos + (opener.img ? 2 : 1), i);
        const link = tryLinkSuffix(s, i + 1, refs, rawText);
        if (link !== null && !bracketsBalanced(rawText)) {
          // Valid suffix but unbalanced link text: not a link, and the
          // opener stays active so a later ] can retry it.
          buf += ']';
          i++;
          continue;
        }
        if (link !== null) {
          // Resolve emphasis inside the link text, then drop those
          // delimiters: they cannot match anything outside the link.
          const inRange = delims.filter((d) => d.seq > opener.tok.seq);
          for (let d = delims.length - 1; d >= 0; d--) {
            if (delims[d].seq > opener.tok.seq) delims.splice(d, 1);
          }
          resolveEmphasis(inRange);
          const startIdx = tokens.indexOf(opener.tok);
          let inner = '';
          for (let t = startIdx + 1; t < tokens.length; t++) inner += expandTok(tokens[t]);
          let html;
          if (opener.img) {
            const alt = stripTags(inner);
            html = `<img src="${escapeAttr(link.href)}" alt="${alt}"${link.title !== null ? ` title="${escapeAttr(link.title)}"` : ''}>`;
          } else {
            html = `<a href="${escapeAttr(link.href)}"${link.title !== null ? ` title="${escapeAttr(link.title)}"` : ''}>${inner}</a>`;
          }
          tokens.splice(startIdx, tokens.length - startIdx, textTok(html));
          // Drop this opener and everything opened after it; earlier
          // openers survive. A link cannot contain a link, so any
          // remaining '[' openers become inactive (images may stay).
          const oi = linkStack.indexOf(opener);
          linkStack.length = oi;
          if (!opener.img) {
            for (const o of linkStack) if (!o.img) o.active = false;
          }
          i = link.end;
          continue;
        }
        // No valid link here: this opener can never match, so it dies
        // and an earlier opener gets its chance at the next ].
        opener.active = false;
      }
      buf += ']';
      i++;
      continue;
    }
    if (c === CODE_STAR || c === CODE_UNDER || c === CODE_TILDE) {
      const ch = String.fromCharCode(c);
      let j = i;
      while (j < n && s.charCodeAt(j) === c) j++;
      const run = j - i;
      // Strikethrough takes one or two tildes; a run of three or
      // more is literal text, never a delimiter.
      if (ch === '~' && run >= 3) {
        buf += '~'.repeat(run);
        i = j;
        continue;
      }
      const fl = flanking(s, i, run);
      let open;
      let close;
      if (ch === '_') {
        open = fl.left && (!fl.right || fl.beforePunct);
        close = fl.right && (!fl.left || fl.afterPunct);
      } else {
        open = fl.left;
        close = fl.right;
      }
      flush();
      const tok = delimTok(ch, run, open, close);
      tokens.push(tok);
      delims.push(tok);
      i = j;
      continue;
    }
    if (c === CODE_AMP) {
      const e = decodeEntityAt(s, i, true);
      flush();
      if (e !== null) {
        tokens.push(textTok(e.ch));
        i = e.end;
      } else {
        tokens.push(textTok('&amp;'));
        i++;
      }
      continue;
    }
    if (c === CODE_LT) {
      const auto = tryAngleAutolink(s, i) ?? tryHtmlTag(s, i);
      if (auto !== null) {
        flush();
        tokens.push(textTok(auto.html));
        i = auto.end;
        continue;
      }
      buf += '&lt;';
      i++;
      continue;
    }
    if (c === CODE_LF) {
      // A hard break (2+ trailing spaces) consumes the trailing
      // whitespace; a soft break keeps it (a single trailing space
      // survives into the output).
      let k = buf.length;
      let spaces = 0;
      while (k > 0 && (buf.charCodeAt(k - 1) === CODE_SPACE || buf.charCodeAt(k - 1) === CODE_TAB)) {
        if (buf.charCodeAt(k - 1) === CODE_SPACE) spaces++;
        k--;
      }
      if (spaces >= 2) buf = buf.slice(0, k);
      flush();
      tokens.push(textTok(spaces >= 2 ? '<br>' : '\n'));
      i++;
      // A hard break swallows the next line's leading indent; a soft
      // break keeps it.
      if (spaces >= 2) {
        while (i < n && (s.charCodeAt(i) === CODE_SPACE || s.charCodeAt(i) === CODE_TAB)) i++;
      }
      continue;
    }
    if (c === CODE_GT) {
      buf += '&gt;';
      i++;
      continue;
    }
    if (c === CODE_QUOT) {
      buf += '&quot;';
      i++;
      continue;
    }
    if (c === CODE_APOS) {
      buf += '&#39;';
      i++;
      continue;
    }
    // Possible extended autolink: www., scheme://, scheme:, bare email.
    // Not inside link text: a link cannot contain another link.
    if (
      (c === 119 || isAlpha(c) || isDigit(c)) &&
      (i === 0 || isWhitespace(s.charCodeAt(i - 1)) || EXT_PREV_OK.has(s.charCodeAt(i - 1))) &&
      !linkStack.some((o) => o.active)
    ) {
      const auto = tryExtendedAutolink(s, i);
      if (auto !== null) {
        flush();
        tokens.push(textTok(auto.html));
        i = auto.end;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  resolveEmphasis(delims);
  let out = '';
  for (const t of tokens) out += expandTok(t);
  return out;
}


// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section',
  'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);

// Columns of the whitespace run starting at text[idx], counting from column
// col. Returns { cols, idx, col }.
function indentRun(text, idx, col) {
  let cols = 0;
  while (idx < text.length) {
    const c = text.charCodeAt(idx);
    if (c === CODE_SPACE) {
      cols++;
      idx++;
      col++;
    } else if (c === CODE_TAB) {
      const w = 4 - (col % 4);
      cols += w;
      idx++;
      col += w;
    } else break;
  }
  return { cols, idx, col };
}

// Remove nCols columns of indent from text starting at idx/col. A tab that
// straddles the boundary becomes spaces. Returns the remaining string.
function stripCols(text, idx, col, nCols) {
  let rest = '';
  let need = nCols;
  while (need > 0 && idx < text.length) {
    const c = text.charCodeAt(idx);
    if (c === CODE_SPACE) {
      idx++;
      col++;
      need--;
    } else if (c === CODE_TAB) {
      const w = 4 - (col % 4);
      if (w <= need) {
        idx++;
        col += w;
        need -= w;
      } else {
        rest = ' '.repeat(w - need);
        idx++;
        col += w;
        need = 0;
      }
    } else break;
  }
  return rest + text.slice(idx);
}

// Expand a leading tab in fenced-code content to spaces (to the next
// tab stop), except a tab at column 0 of a top-level fence, which the
// reference keeps as a raw tab. The column counts each '>' marker as
// one column; the caller subtracts one per quote container because
// the optional space after '>' does not advance the column.
function expandFencedTab(text, col) {
  if (text.length === 0 || text.charCodeAt(0) !== CODE_TAB) return text;
  if (col <= 0) return text;
  const w = 4 - (col % 4);
  return ' '.repeat(w) + text.slice(1);
}





function isBlankLine(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== CODE_SPACE && c !== CODE_TAB) return false;
  }
  return true;
}

// Split a table row line into cells: split on unescaped |, dropping a
// leading and a trailing empty segment (from leading/trailing pipes).
function splitRow(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === CODE_BACKSLASH && i + 1 < line.length && line.charCodeAt(i + 1) === CODE_PIPE) {
      // An escaped pipe is a cell separator that stays literal: the
      // backslash is consumed, the pipe is cell content.
      cur += '|';
      i++;
      continue;
    }
    if (c === CODE_PIPE) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += line[i];
  }
  cells.push(cur);
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

// A delimiter row: cells of optional : , dashes, optional : .
function parseDelimiterRow(line) {
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const align = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    align.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return align;
}

// Setext underline level: 1 for ===, 2 for ---, 0 otherwise.
function setextLevel(s) {
  if (!s) return 0;
  const ch = s.charCodeAt(0);
  if (ch !== CODE_EQ && ch !== CODE_DASH) return 0;
  let k = 0;
  while (k < s.length && s.charCodeAt(k) === ch) k++;
  while (k < s.length && (s.charCodeAt(k) === CODE_SPACE || s.charCodeAt(k) === CODE_TAB)) k++;
  if (k !== s.length) return 0;
  return ch === CODE_EQ ? 1 : 2;
}

function isThematicBreak(s) {
  if (!s) return false;
  const ch = s.charCodeAt(0);
  if (ch !== CODE_DASH && ch !== CODE_STAR && ch !== CODE_UNDER) return false;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === ch) count++;
    else if (c !== CODE_SPACE && c !== CODE_TAB) return false;
  }
  return count >= 3;
}

// Parse leading link reference definitions from a paragraph's lines.
// Returns { rest } (the lines that are not definitions). Definitions are
// registered in refs (first definition of a label wins).
function parseRefDefs(lines, refs) {
  let li = 0;
  while (li < lines.length) {
    const line = lines[li];
    // Up to 3 spaces of indent, then [label]:
    const r = indentRun(line, 0, 0);
    if (r.cols > 3) break;
    let p = r.idx;
    if (p >= line.length || line.charCodeAt(p) !== CODE_LBRACKET) break;
    // Label: ends at the first unescaped ']', contains no unescaped '[',
    // at most 999 chars, and may span lines (the newlines become part of
    // the label text for normalization).
    let ci = li;
    let cp = p + 1;
    let labelText = '';
    let labelEnd = -1;
    let labelInvalid = false;
    while (ci < lines.length && labelEnd === -1 && !labelInvalid) {
      const ln2 = lines[ci];
      while (cp < ln2.length) {
        const c = ln2.charCodeAt(cp);
        if (c === CODE_BACKSLASH && cp + 1 < ln2.length && isAsciiPunct(ln2.charCodeAt(cp + 1))) {
          labelText += ln2[cp] + ln2[cp + 1];
          cp += 2;
          continue;
        }
        if (c === CODE_LBRACKET) {
          labelInvalid = true;
          break;
        }
        if (c === CODE_RBRACKET) {
          labelEnd = cp;
          break;
        }
        labelText += ln2[cp];
        cp++;
      }
      if (labelEnd !== -1 || labelInvalid) break;
      if (ci + 1 < lines.length) {
        labelText += '\n';
        ci++;
        cp = 0;
      } else {
        break;
      }
    }
    if (labelEnd === -1 || labelInvalid) break;
    if (labelText.length === 0 || labelText.length > 999) break;
    if (labelEnd + 1 >= lines[ci].length || lines[ci].charCodeAt(labelEnd + 1) !== CODE_COLON) break;
    // Cursor over lines for the destination and title.
    cp = labelEnd + 2;
    const skipInlineWs = () => {
      while (ci < lines.length) {
        const ln = lines[ci];
        while (cp < ln.length && (ln.charCodeAt(cp) === CODE_SPACE || ln.charCodeAt(cp) === CODE_TAB)) cp++;
        if (cp < ln.length) return true;
        // End of this line: move to the next line if there is one.
        if (ci + 1 < lines.length) {
          ci++;
          cp = 0;
          continue;
        }
        return false;
      }
      return false;
    };
    const atEol = () => {
      while (cp < lines[ci].length && (lines[ci].charCodeAt(cp) === CODE_SPACE || lines[ci].charCodeAt(cp) === CODE_TAB)) cp++;
      return cp >= lines[ci].length;
    };
    if (!skipInlineWs()) break;
    // Destination.
    let dest = null;
    let ln = lines[ci];
    if (ln.charCodeAt(cp) === CODE_LT) {
      let k = cp + 1;
      let ok = false;
      while (k < ln.length) {
        const c = ln.charCodeAt(k);
        if (c === CODE_BACKSLASH && k + 1 < ln.length && isAsciiPunct(ln.charCodeAt(k + 1))) {
          k += 2;
          continue;
        }
        if (c === CODE_LT || c === CODE_LF) break;
        if (c === CODE_GT) {
          ok = true;
          break;
        }
        k++;
      }
      if (!ok) break;
      dest = unescapeStr(ln.slice(cp + 1, k));
      cp = k + 1;
    } else {
      let k = cp;
      let depth2 = 0;
      while (k < ln.length) {
        const c = ln.charCodeAt(k);
        if (c === CODE_BACKSLASH && k + 1 < ln.length && isAsciiPunct(ln.charCodeAt(k + 1))) {
          k += 2;
          continue;
        }
        if (c === CODE_LPAREN) depth2++;
        else if (c === CODE_RPAREN) {
          if (depth2 === 0) break;
          depth2--;
        } else if (c <= 32 || c === 127) break;
        k++;
      }
      if (k === cp) break;
      dest = unescapeStr(ln.slice(cp, k));
      cp = k;
    }
    // Optional title: same line, or the next line if this one ends here.
    let title = null;
    let titleParsed = false;
    const tryTitleAt = () => {
      const l2 = lines[ci];
      if (cp >= l2.length) return false;
      const q = l2.charCodeAt(cp);
      if (q !== CODE_QUOT && q !== CODE_APOS && q !== CODE_LPAREN) return false;
      const closeCh = q === CODE_LPAREN ? CODE_RPAREN : q;
      let k = cp + 1;
      let startLine = ci;
      let startCol = k;
      let ok = false;
      let endLine = ci;
      let endCol = -1;
      while (ci < lines.length) {
        const cur = lines[ci];
        while (k < cur.length) {
          const c = cur.charCodeAt(k);
          if (c === CODE_BACKSLASH && k + 1 < cur.length && isAsciiPunct(cur.charCodeAt(k + 1))) {
            k += 2;
            continue;
          }
          if (c === closeCh) {
            ok = true;
            endLine = ci;
            endCol = k;
            break;
          }
          k++;
        }
        if (ok) break;
        ci++;
        k = 0;
      }
      if (!ok) return false;
      // Rebuild the title text across lines.
      let t = '';
      for (let l = startLine; l <= endLine; l++) {
        if (l === startLine && l === endLine) t += lines[l].slice(startCol, endCol);
        else if (l === startLine) t += lines[l].slice(startCol);
        else if (l === endLine) t += `\n${lines[l].slice(0, endCol)}`;
        else t += `\n${lines[l]}`;
      }
      title = unescapeStr(t);
      titleParsed = true;
      ci = endLine;
      cp = endCol + 1;
      return true;
    };
    // A title on the same line must be preceded by whitespace; a title
    // on the next line must be the only thing on that line, or the
    // definition simply has no title.
    const cpBeforeWs = cp;
    if (atEol()) {
      // Try the title on the next line.
      if (ci + 1 < lines.length) {
        const saveCi = ci;
        const saveCp = cp;
        ci++;
        cp = 0;
        while (cp < lines[ci].length && (lines[ci].charCodeAt(cp) === CODE_SPACE || lines[ci].charCodeAt(cp) === CODE_TAB)) cp++;
        if (tryTitleAt()) {
          if (!atEol()) {
            // Extra content after the title: the title is not part of
            // this definition. Restore and keep it title-less.
            ci = saveCi;
            cp = saveCp;
            title = null;
            titleParsed = false;
          }
        } else {
          ci = saveCi;
          cp = saveCp;
        }
      }
    } else {
      // More content on this line: it must be a title, and it must
      // have been preceded by whitespace (atEol skipped any).
      if (cp === cpBeforeWs) break;
      if (!tryTitleAt()) break;
    }
    if (titleParsed) {
      if (!atEol()) break;
    } else if (!atEol()) {
      break;
    }
    // Valid definition: register it and consume through line ci. A
    // label that normalizes to empty (e.g. only whitespace) is not a
    // definition at all.
    const label = normalizeLabel(labelText);
    if (label.length === 0) break;
    if (!refs.has(label)) {
      refs.set(label, { href: cleanUrl(dest), title });
    }
    li = ci + 1;
  }
  return { rest: lines.slice(li) };
}

// Detect an HTML block start in `rest` (the line after up to 3 spaces of
// indent). Returns the end kind 1-7, or 0.
function htmlBlockStart(rest) {
  const lower = rest.toLowerCase();
  for (const tag of ['script', 'pre', 'style', 'textarea']) {
    if (lower.startsWith(`<${tag}`)) {
      const after = rest.length > tag.length + 1 ? rest.charCodeAt(tag.length + 1) : -1;
      if (after === -1 || after === CODE_SPACE || after === CODE_TAB || after === CODE_GT) return 1;
    }
  }
  if (rest.startsWith('<!--')) return 2;
  if (rest.startsWith('<?')) return 3;
  if (rest.startsWith('<!') && rest.length > 2 && isAlpha(rest.charCodeAt(2))) return 4;
  if (rest.startsWith('<![CDATA[')) return 5;
  // Type 6: < or </ + block tag, followed by space/tab/>/end.
  let j = 0;
  if (rest.charCodeAt(0) === CODE_LT) {
    j = 1;
    if (rest.charCodeAt(1) === CODE_SLASH) j = 2;
    if (j < rest.length && isAlpha(rest.charCodeAt(j))) {
      const ns = j;
      while (j < rest.length && (isAlnum(rest.charCodeAt(j)) || rest.charCodeAt(j) === CODE_DASH)) j++;
      const name = rest.slice(ns, j).toLowerCase();
      if (BLOCK_TAGS.has(name)) {
        const after = j < rest.length ? rest.charCodeAt(j) : -1;
        if (after === -1 || after === CODE_SPACE || after === CODE_TAB || after === CODE_GT || after === CODE_SLASH) return 6;
      }
    }
  }
  // Type 7: the line is exactly one complete open or closing tag.
  const tag = tryHtmlTag(rest, 0);
  if (tag !== null) {
    let k = tag.end;
    while (k < rest.length && (rest.charCodeAt(k) === CODE_SPACE || rest.charCodeAt(k) === CODE_TAB)) k++;
    if (k === rest.length) return 7;
  }
  return 0;
}

function htmlBlockEnds(kind, line) {
  const lower = line.toLowerCase();
  if (kind === 1) {
    return (
      lower.includes('</script') ||
      lower.includes('</pre') ||
      lower.includes('</style') ||
      lower.includes('</textarea')
    );
  }
  if (kind === 2) return line.includes('-->');
  if (kind === 3) return line.includes('?>');
  if (kind === 4) return line.includes('>');
  if (kind === 5) return line.includes(']]>');
  return false;
}

// Match a list marker at the start of `rest`. Returns null or
// { ordered, bullet, start, markerCols, markerEnd, spacesCols, spacesChars, empty }.
function matchListMarker(rest, startCol) {
  const n = rest.length;
  let ordered = false;
  let bullet = '';
  let start = 1;
  let markerCols = 0;
  let markerEnd = 0;
  const c0 = rest.charCodeAt(0);
  if (c0 === CODE_DASH || c0 === CODE_PLUS || c0 === CODE_STAR) {
    bullet = rest[0];
    markerCols = 1;
    markerEnd = 1;
  } else if (isDigit(c0)) {
    let k = 0;
    while (k < n && isDigit(rest.charCodeAt(k))) k++;
    if (k > 9 || k >= n) return null;
    const d = rest.charCodeAt(k);
    if (d !== CODE_DOT && d !== CODE_RPAREN) return null;
    ordered = true;
    bullet = String.fromCharCode(d);
    start = parseInt(rest.slice(0, k), 10);
    markerCols = k + 1;
    markerEnd = k + 1;
  } else {
    return null;
  }
  // Must be followed by a space/tab or end of line.
  if (markerEnd < n) {
    const c = rest.charCodeAt(markerEnd);
    if (c !== CODE_SPACE && c !== CODE_TAB) return null;
  }
  const r = indentRun(rest, markerEnd, startCol + markerCols);
  const empty = r.idx >= n;
  return {
    ordered,
    bullet,
    start,
    markerCols,
    markerEnd,
    spacesCols: r.cols,
    spacesChars: r.idx - markerEnd,
    empty,
  };
}

// ---------------------------------------------------------------------------
// Block structure: containers, leaves, new blocks
// ---------------------------------------------------------------------------

// Does the line (tail, after container markers) start a new block at all?
// Used for lazy paragraph continuations: a line that starts any block
// (ATX heading, fenced code, HTML block types 1-6, thematic break,
// blockquote, or a list marker of any kind at indent <= 3) is not a lazy
// continuation. Indented code and HTML block type 7 cannot start a block
// that interrupts a paragraph, so they do not count.
function lineStartsNewBlock(tail, tailCol) {
  const r = indentRun(tail, 0, tailCol);
  if (r.cols > 3) return false;
  const rest = tail.slice(r.idx);
  if (rest.length === 0) return false;
  const c0 = rest.charCodeAt(0);
  if (c0 === CODE_HASH) {
    let k = 0;
    while (k < rest.length && rest.charCodeAt(k) === CODE_HASH) k++;
    return k >= 1 && k <= 6 && (k === rest.length || rest.charCodeAt(k) === CODE_SPACE || rest.charCodeAt(k) === CODE_TAB);
  }
  if (c0 === CODE_BACKTICK || c0 === CODE_TILDE) {
    const fc = c0;
    let k = 0;
    while (k < rest.length && rest.charCodeAt(k) === fc) k++;
    return k >= 3 && !(fc === CODE_BACKTICK && rest.slice(k).includes('`'));
  }
  if (isThematicBreak(rest)) return true;
  if (c0 === CODE_GT) return true;
  const hb = htmlBlockStart(rest);
  if (hb >= 1 && hb <= 6) return true;
  if (hb === 7) return false;
  const lm = matchListMarker(rest, tailCol + r.cols);
  return lm !== null;
}

// Does the line (tail, after container markers) start a block that can
// interrupt a paragraph? ATX heading, fenced code, HTML block types 1-6,
// thematic break, blockquote, or a list that can interrupt (bullet with a
// non-empty first item, ordered starting at 1 with a non-empty first item).
function lineInterruptsPara(tail, tailCol, inItem = false) {
  const r = indentRun(tail, 0, tailCol);
  if (r.cols > 3) return false;
  const rest = tail.slice(r.idx);
  if (rest.length === 0) return false;
  const c0 = rest.charCodeAt(0);
  if (c0 === CODE_HASH) {
    let k = 0;
    while (k < rest.length && rest.charCodeAt(k) === CODE_HASH) k++;
    return k >= 1 && k <= 6 && (k === rest.length || rest.charCodeAt(k) === CODE_SPACE || rest.charCodeAt(k) === CODE_TAB);
  }
  if (c0 === CODE_BACKTICK || c0 === CODE_TILDE) {
    const fc = c0;
    let k = 0;
    while (k < rest.length && rest.charCodeAt(k) === fc) k++;
    return k >= 3 && !(fc === CODE_BACKTICK && rest.slice(k).includes('`'));
  }
  if (isThematicBreak(rest)) return true;
  if (c0 === CODE_GT) return true;
  const hb = htmlBlockStart(rest);
  if (hb >= 1 && hb <= 6) return true;
  const lm = matchListMarker(rest, tailCol + r.cols);
  if (lm !== null) {
    // Inside a list item, any non-empty list marker starts a nested
    // list (the start-1 rule is for a list interrupting a paragraph
    // at the same level).
    if (lm.ordered) return (lm.start === 1 || inItem) && !lm.empty;
    return !lm.empty;
  }
  return false;
}

function parseBlocks(input) {
  const src = input.replace(/\r\n?/g, '\n');
  const inputEndsWithNewline = src.endsWith('\n');
  const lines = src.split('\n');
  // A trailing empty line from the final newline is not a line of content;
  // keep it out of the line list (a blank line at the end changes nothing).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const refs = new Map();
  const root = { t: 'doc', ch: [] };
  const stack = [root];

  const addChild = (node) => {
    const parent = stack[stack.length - 1];
    parent.ch.push(node);
    node._parent = parent;
  };
  const closeTo = (depth) => {
    while (stack.length > depth) {
      const node = stack.pop();
      finalize(node, refs);
    }
  };
  // A blank line records the innermost container open at that moment.
  // When the next block starts, only the list directly affected becomes
  // loose: a list whose items are separated by the blank (the blank was
  // directly inside one of its items), or a list whose item gains a
  // second direct block child after a blank directly inside that item.
  // A blank nested inside a quote or a nested list does not loosen the
  // outer list.
  let blankContainer = null;
  const noteBlank = () => {
    blankContainer = null;
    for (let d = stack.length - 1; d >= 1; d--) {
      const b = stack[d];
      if (b.t === 'quote' || b.t === 'item' || b.t === 'list') {
        blankContainer = b;
        break;
      }
    }
  };
  // Is `node` the same as `ancestor`, or contained inside it?
  const isInside = (node, ancestor) => {
    let cur = node;
    while (cur) {
      if (cur === ancestor) return true;
      cur = cur._parent;
    }
    return false;
  };
  const noteBlockStart = () => {
    if (!blankContainer) return;
    const bc = blankContainer;
    blankContainer = null;
    const parent = stack[stack.length - 1];
    // A list is loose when an item gains a second block child after a
    // blank line. The blank counts when it fell inside that item, even
    // nested inside a sub-list or quote within it.
    if (parent.t === 'item' && isInside(bc, parent)) {
      if (parent.ch.length > 0) {
        const list = parent._parent;
        if (list && list.t === 'list') list.tight = false;
      }
    }
  };
  const replaceInParent = (parent, oldNode, newNode) => {
    const idx = parent.ch.lastIndexOf(oldNode);
    if (idx !== -1) {
      parent.ch[idx] = newNode;
      newNode._parent = parent;
    }
  };

  for (let li = 0; li < lines.length; li++) {
    let tail = lines[li];
    let tailCol = 0;
    const blank = isBlankLine(tail);

    // --- Container matching ---
    // Only containers (quote/item/list) are matched; the leaf on top of the
    // stack is never closed here. `lazyStrip` is the indent (in columns)
    // measured when an item failed to match, for lazy paragraph
    // continuations. A fenced code block swallows its content lines
    // even when they do not match an outer container (no '>' marker,
    // or less indented than the item): the line is code, not a reason
    // to close the containers.
    const leafIsFencedCode =
      stack.length > 1 &&
      stack[stack.length - 1].t === 'code' &&
      stack[stack.length - 1].fenced;
    let depth = 1;
    let mismatch = false;
    let lazyStrip = 0;
    while (depth < stack.length) {
      const b = stack[depth];
      if (b.t === 'quote') {
        // A truly blank line does not match a blockquote: it ends the
        // quote (a '>' line with nothing after it does match, via the
        // marker below, and is a blank line inside the quote).
        const r = indentRun(tail, 0, tailCol);
        if (r.cols <= 3 && r.idx < tail.length && tail.charCodeAt(r.idx) === CODE_GT) {
          let nidx = r.idx + 1;
          let ncol = r.col + 1;
          let nt = tail.slice(nidx);
          if (nt.length > 0) {
            const c = nt.charCodeAt(0);
            if (c === CODE_SPACE) {
              nt = nt.slice(1);
              ncol++;
            } else if (c === CODE_TAB) {
              const w = 4 - (ncol % 4);
              nt = ' '.repeat(w - 1) + nt.slice(1);
              ncol++;
            }
          }
          tail = nt;
          tailCol = ncol;
          depth++;
          continue;
        }
        mismatch = true;
        break;
      }
      if (b.t === 'item') {
        // A line that is blank once its outer containers are stripped
        // (e.g. '>>' inside a quote that is inside this item) is a
        // blank line inside the item, even though the raw line is not
        // blank.
        if (blank || isBlankLine(tail)) {
          depth++;
          continue;
        }
        const r = indentRun(tail, 0, tailCol);
        if (r.cols >= b.contentIndent) {
          tail = stripCols(tail, 0, tailCol, b.contentIndent);
          tailCol = tailCol + b.contentIndent;
          depth++;
          continue;
        }
        if (leafIsFencedCode) {
          depth++;
          continue;
        }
        lazyStrip = r.cols;
        mismatch = true;
        break;
      }
      if (b.t === 'list') {
        depth++;
        continue;
      }
      break;
    }
    // The tail's blankness (after container markers are stripped) is what
    // the leaf continuation cares about. A tail that is only whitespace
    // because a container marker was stripped (e.g. '>  ' leaves ' ') is
    // content, not a blank line; only an empty tail, or a whitespace-only
    // tail that was never stripped, counts as blank.
    const tailBlank = tail.length === 0 || (isBlankLine(tail) && tail === lines[li]);

    let consumed = false;

    // Lazy paragraph continuation: the leaf is a paragraph, a container
    // failed to match, the line is not blank, and it does not start a
    // block that interrupts a paragraph. The line joins the paragraph
    // with the indent stripped as far as container matching got.
    const top0 = stack[stack.length - 1];
    if (mismatch && !tailBlank && top0.t === 'para' && !lineStartsNewBlock(tail, tailCol)) {
      // A lazy line joins the paragraph with its leading whitespace
      // stripped. A lazy line that looks like a setext underline is
      // kept as literal text, indented so it cannot become a heading.
      const lr = indentRun(tail, 0, tailCol);
      let lazyLine = stripCols(tail, 0, tailCol, lr.cols);
      if (setextLevel(lazyLine) > 0) lazyLine = '    ' + lazyLine;
      top0.lines.push(lazyLine);
      consumed = true;
    } else if (mismatch) {
      closeTo(depth);
    }

    // --- Leaf continuation --- (skipped when the lazy branch already
    // consumed the line)
    const top = stack[stack.length - 1];
    if (!consumed && top.t === 'code' && top.fenced) {
      const r = indentRun(tail, 0, tailCol);
      if (r.cols <= 3) {
        const rest = tail.slice(r.idx);
        const fc = rest.charCodeAt(0);
        if (fc === top.fenceChar) {
          let k = 0;
          while (k < rest.length && rest.charCodeAt(k) === fc) k++;
          if (k >= top.fenceLen) {
            let ok = true;
            for (let m = k; m < rest.length; m++) {
              const cc = rest.charCodeAt(m);
              if (cc !== CODE_SPACE && cc !== CODE_TAB) {
                ok = false;
                break;
              }
            }
            if (ok) {
              top.closed = true;
              stack.pop();
              finalize(top, refs);
              consumed = true;
            }
          }
        }
      }
      if (!consumed) {
        // The column for tab expansion counts each '>' marker as one
        // column; the optional space after it does not advance the
        // column, so subtract one per quote container on the stack.
        let q = 0;
        for (let s = 0; s < stack.length; s++) if (stack[s].t === 'quote') q++;
        top.lines.push(expandFencedTab(stripCols(tail, 0, tailCol, top.fenceIndent), tailCol + top.fenceIndent - q));
        consumed = true;
      }
    } else if (!consumed && top.t === 'code' && !top.fenced) {
      if (tailBlank) {
        // A blank line in indented code keeps its indent minus 4 columns.
        top.lines.push(stripCols(tail, 0, tailCol, 4));
        consumed = true;
      } else {
        // Indented code needs 4 spaces of indent in the line itself,
        // relative to its container: the container's own indent does
        // not count (a blockquote marker after 4 spaces is a blockquote,
        // not code).
        const r = indentRun(tail, 0, tailCol);
        if (r.cols >= 4) {
          top.lines.push(stripCols(tail, 0, tailCol, 4));
          consumed = true;
        } else {
          stack.pop();
          finalize(top, refs);
        }
      }
    } else if (!consumed && top.t === 'html') {
      if (tailBlank && (top.endKind === 6 || top.endKind === 7)) {
        top.endedByBlank = true;
        stack.pop();
        finalize(top, refs);
        noteBlank();
        consumed = true;
      } else {
        top.lines.push(tail);
        consumed = true;
        if (top.endKind >= 1 && top.endKind <= 5 && htmlBlockEnds(top.endKind, tail)) {
          top.followedByBlank = li + 1 < lines.length && isBlankLine(lines[li + 1]) && !lines[li + 1].includes('\t');
          stack.pop();
          finalize(top, refs);
        }
      }
    } else if (!consumed && top.t === 'para') {
      if (tailBlank) {
        stack.pop();
        finalize(top, refs);
        noteBlank();
        consumed = true;
      } else {
        const r = indentRun(tail, 0, tailCol);
        const rest = tail.slice(r.idx);
        let setextDone = false;
        if (r.cols <= 3) {
          const lvl = setextLevel(rest);
          if (lvl > 0) {
            const { rest: restLines } = parseRefDefs(top.lines, refs);
            top._defsDone = true;
            stack.pop();
            if (restLines.length > 0) {
              // A setext heading's content drops the paragraph's
              // leading spaces and trailing whitespace.
              const raw = restLines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
              replaceInParent(stack[stack.length - 1], top, { t: 'heading', level: lvl, raw });
              consumed = true;
            } else {
              // Paragraph was only definitions: drop it, and let this
              // line be reprocessed as a new block (it is not a setext
              // underline for anything).
              const parent = stack[stack.length - 1];
              parent.ch.pop();
            }
            setextDone = true;
          } else if (top.lines.length === 1) {
            const align = parseDelimiterRow(rest);
            if (align !== null) {
              const head = splitRow(top.lines[0]);
              if (head.length >= 1 && align.length === head.length) {
                const table = { t: 'table', head, align, rows: [] };
                replaceInParent(stack[stack.length - 2], top, table);
                stack.pop();
                stack.push(table);
                consumed = true;
              }
            }
          }
        }
        if (!consumed && !setextDone) {
          // Interrupting blocks close the paragraph; otherwise the line
          // is a paragraph continuation, kept as-is.
          const inItem = top._parent !== undefined && top._parent.t === 'item';
          if (lineInterruptsPara(tail, tailCol, inItem)) {
            stack.pop();
            finalize(top, refs);
          } else {
            top.lines.push(tail);
            consumed = true;
          }
        }
      }
    } else if (!consumed && top.t === 'table') {
      if (tailBlank && !tail.includes('\t')) {
        stack.pop();
        finalize(top, refs);
        noteBlank();
        consumed = true;
      } else if (lineInterruptsPara(tail, tailCol)) {
        // A line that starts another block, or (for a multi-column
        // table) a line with no cell separator, ends the table; the
        // line is reprocessed as a new block.
        stack.pop();
        finalize(top, refs);
      } else {
        top.rows.push(splitRow(tail));
        consumed = true;
      }
    }

    // --- New blocks ---
    while (!consumed) {
      if (isBlankLine(tail)) {
        noteBlank();
        // An empty list item cannot gain content after a blank line:
        // close it here so following indented text falls outside the
        // list. (A non-empty item stays open across blank lines.)
        const topB = stack[stack.length - 1];
        if (topB.t === 'item' && topB.ch.length === 0) {
          stack.pop();
          finalize(topB, refs);
        }
        consumed = true;
        break;
      }
      const r = indentRun(tail, 0, tailCol);
      const rest = tail.slice(r.idx);
      const baseCol = tailCol + r.cols;
      // A list can only contain list items. If the stack top is a list
      // and this line does not start a new item of the same list, the
      // list ends here. A thematic break also ends the list, even when
      // the line looks like a list marker (e.g. '* * *').
      const topNode0 = stack[stack.length - 1];
      if (topNode0.t === 'list') {
        const lm0 = r.cols <= 3 ? matchListMarker(rest, baseCol) : null;
        if (isThematicBreak(rest) || !(lm0 && lm0.ordered === topNode0.ordered && lm0.bullet === topNode0.bullet)) {
          stack.pop();
          finalize(topNode0, refs);
        }
      }
      if (r.cols >= 4) {
        noteBlockStart();
        const node = { t: 'code', fenced: false, lines: [stripCols(tail, 0, tailCol, 4)] };
        addChild(node);
        stack.push(node);
        consumed = true;
        break;
      }
      // ATX heading.
      if (rest.charCodeAt(0) === CODE_HASH) {
        let k = 0;
        while (k < rest.length && rest.charCodeAt(k) === CODE_HASH) k++;
        if (k >= 1 && k <= 6 && (k === rest.length || rest.charCodeAt(k) === CODE_SPACE || rest.charCodeAt(k) === CODE_TAB)) {
          let content = rest.slice(k).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          let e = content.length;
          while (e > 0 && (content.charCodeAt(e - 1) === CODE_SPACE || content.charCodeAt(e - 1) === CODE_TAB)) e--;
          let h = e;
          while (h > 0 && content.charCodeAt(h - 1) === CODE_HASH) h--;
          if (h < e && h > 0 && (content.charCodeAt(h - 1) === CODE_SPACE || content.charCodeAt(h - 1) === CODE_TAB)) {
            content = content.slice(0, h).replace(/[ \t]+$/, '');
          } else if (h === 0 && e > 0) {
            content = '';
          }
          noteBlockStart();
          addChild({ t: 'heading', level: k, raw: content });
          consumed = true;
          break;
        }
      }
      // Fenced code.
      if (rest.charCodeAt(0) === CODE_BACKTICK || rest.charCodeAt(0) === CODE_TILDE) {
        const fc = rest.charCodeAt(0);
        let k = 0;
        while (k < rest.length && rest.charCodeAt(k) === fc) k++;
        if (k >= 3 && !(fc === CODE_BACKTICK && rest.slice(k).includes('`'))) {
          const info = rest.slice(k);
          // The info string's backslash escapes are processed before
          // taking the first word as the language.
          const lang = unescapeStr(info).trim().split(/[ \t]/)[0] || '';
          noteBlockStart();
          const node = { t: 'code', fenced: true, fenceChar: fc, fenceLen: k, fenceIndent: r.cols, info, lang, lines: [] };
          addChild(node);
          stack.push(node);
          consumed = true;
          break;
        }
      }
      // HTML block. The lines are stored verbatim (after container
      // markers), including up to 3 spaces of leading indent.
      const hb = htmlBlockStart(rest);
      if (hb > 0) {
        noteBlockStart();
        const node = { t: 'html', endKind: hb, lines: [tail], endedByBlank: false, atEof: false, followedByBlank: false };
        addChild(node);
        // Types 1-5 end when the end string appears; if the first line
        // already contains it, the block is complete at once.
        if (hb >= 1 && hb <= 5 && htmlBlockEnds(hb, tail)) {
          node.followedByBlank = li + 1 < lines.length && isBlankLine(lines[li + 1]) && !lines[li + 1].includes('\t');
        } else {
          stack.push(node);
        }
        consumed = true;
        break;
      }
      // Thematic break.
      if (isThematicBreak(rest)) {
        noteBlockStart();
        addChild({ t: 'hr' });
        consumed = true;
        break;
      }
      // Blockquote.
      if (rest.charCodeAt(0) === CODE_GT) {
        noteBlockStart();
        const q = { t: 'quote', ch: [] };
        addChild(q);
        stack.push(q);
        let nt = rest.slice(1);
        let ncol = baseCol + 1;
        if (nt.length > 0) {
          const c = nt.charCodeAt(0);
          if (c === CODE_SPACE) {
            nt = nt.slice(1);
            ncol++;
          } else if (c === CODE_TAB) {
            const w = 4 - (ncol % 4);
            nt = ' '.repeat(w - 1) + nt.slice(1);
            ncol++;
          }
        }
        tail = nt;
        tailCol = ncol;
        continue;
      }
      // List.
      const lm = matchListMarker(rest, baseCol);
      if (lm !== null) {
        let list = null;
        const topNode = stack[stack.length - 1];
        if (topNode.t === 'list' && topNode.ordered === lm.ordered && topNode.bullet === lm.bullet) {
          // New item in the same list: items separated by a blank line
          // make the list loose. The blank counts when it fell directly
          // inside the list or inside one of its items (even nested in
          // a sub-list), but not when it fell inside a quote or other
          // non-list block within an item.
          list = topNode;
          if (
            blankContainer &&
            (blankContainer === list ||
              ((blankContainer.t === 'item' || blankContainer.t === 'list') && isInside(blankContainer, list))) &&
            list.ch.length > 0
          ) {
            list.tight = false;
          }
          blankContainer = null;
        } else {
          if (topNode.t === 'list') {
            stack.pop();
            finalize(topNode, refs);
          }
          // A new (possibly nested) list: it starts tight. If it is a
          // direct child of an item that already has a block child, the
          // blank line makes that item's list loose.
          noteBlockStart();
          list = { t: 'list', ordered: lm.ordered, bullet: lm.bullet, start: lm.start, tight: true, ch: [] };
          addChild(list);
          stack.push(list);
        }
        // The item's content indent, in columns from the start of the
        // line as seen after its containers were stripped (not an
        // absolute column: container markers shift between lines, so an
        // absolute column would mis-match continuations). It is the
        // indent before the marker plus the marker and its spaces.
        let contentIndent;
        if (lm.empty) {
          contentIndent = r.cols + lm.markerCols + 1;
        } else if (lm.spacesCols >= 1 && lm.spacesCols <= 4) {
          contentIndent = r.cols + lm.markerCols + lm.spacesCols;
        } else {
          contentIndent = r.cols + lm.markerCols + 1;
        }
        const item = { t: 'item', ch: [], contentIndent };
        item._parent = list;
        list.ch.push(item);
        stack.push(item);
        if (lm.empty) {
          consumed = true;
          break;
        }
        if (lm.spacesCols >= 1 && lm.spacesCols <= 4) {
          tail = rest.slice(lm.markerEnd + lm.spacesChars);
          tailCol = tailCol + contentIndent;
        } else {
          tail = stripCols(rest, lm.markerEnd, baseCol + lm.markerCols, 1);
          tailCol = tailCol + contentIndent;
        }
        continue;
      }
      // Paragraph. The first line keeps its leading spaces (up to 3);
      // they are part of the paragraph text.
      noteBlockStart();
      const node = { t: 'para', lines: [tail] };
      addChild(node);
      stack.push(node);
      consumed = true;
      break;
    }
  }

  while (stack.length > 1) {
    const node = stack.pop();
    // A type 6-7 HTML block at the end of the input gets a trailing
    // newline only if the input itself ends with one.
    if (node.t === 'html') node.atEof = inputEndsWithNewline;
    finalize(node, refs);
  }
  return { root, refs };
}

// Finalize a leaf node: strip link reference definitions from paragraphs,
// trim trailing blank lines from indented code.
function finalize(node, refs) {
  if (node.t === 'para') {
    if (!node._defsDone) {
      const { rest } = parseRefDefs(node.lines, refs);
      node.lines = rest;
      node._defsDone = true;
    }
    if (node.lines.length === 0) {
      // Paragraph was only definitions: remove it from its parent.
      const parent = node._parent;
      if (parent) {
        const idx = parent.ch.indexOf(node);
        if (idx !== -1) parent.ch.splice(idx, 1);
      }
    }
  } else if (node.t === 'code' && !node.fenced) {
    while (node.lines.length > 0 && node.lines[node.lines.length - 1] === '') {
      node.lines.pop();
    }
  }
}

// Render the block tree to HTML. `refs` is the link reference map.
function renderDoc(root, refs) {
  let out = '';
  const renderNodes = (nodes) => {
    for (const node of nodes) renderNode(node);
  };
  const renderChildren = (node) => {
    renderNodes(node.ch);
  };
  const renderNode = (node) => {
    if (node.t === 'para') {
      if (node.lines.length === 0) return;
      out += `<p>${parseInline(node.lines.join('\n'), refs)}</p>\n`;
    } else if (node.t === 'heading') {
      out += `<h${node.level}>${parseInline(node.raw, refs)}</h${node.level}>\n`;
    } else if (node.t === 'code') {
      // A fenced block drops a single trailing blank line: the newline
      // before its closing fence belongs to the fence, and an unclosed
      // fence that ends at a blank line drops it the same way.
      let codeLines = node.lines;
      if (node.fenced && codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
        codeLines = codeLines.slice(0, codeLines.length - 1);
      }
      const content = codeLines.length > 0 ? codeLines.join('\n') + '\n' : '';
      if (node.fenced && node.lang) {
        out += `<pre><code class="language-${escapeAttr(node.lang)}">${escapeHtml(content)}</code></pre>\n`;
      } else {
        out += `<pre><code>${escapeHtml(content)}</code></pre>\n`;
      }
    } else if (node.t === 'html') {
      // Lines joined by newlines. Types 1-5 get a trailing newline
      // unless the next line after the block is blank; types 6-7 get
      // one only when the block ran to the end of the input AND the
      // input itself ends with a newline.
      const trail = node.endKind >= 1 && node.endKind <= 5 ? !node.followedByBlank : node.atEof;
      out += node.lines.join('\n') + (trail ? '\n' : '');
    } else if (node.t === 'quote') {
      out += '<blockquote>\n';
      renderChildren(node);
      out += '</blockquote>\n';
    } else if (node.t === 'list') {
      if (node.ordered) {
        out += node.start !== 1 ? `<ol start="${node.start}">\n` : '<ol>\n';
      } else {
        out += '<ul>\n';
      }
      renderChildren(node);
      out += node.ordered ? '</ol>\n' : '</ul>\n';
    } else if (node.t === 'item') {
      out += '<li>';
      const ch = node.ch;
      for (let i = 0; i < ch.length; i++) {
        const child = ch[i];
        if (child.t === 'para') {
          const text = child.lines.join('\n');
          // Task checkbox: only the item's first paragraph.
          const cb = i === 0 ? extractCheckbox(text) : null;
          if (node._listTight) {
            // Tight list: paragraph renders as bare inline content, with
            // no trailing newline even before a following block child.
            if (cb) {
              out += cb.box + parseInline(cb.rest, refs);
            } else if (text.length > 0) {
              out += parseInline(text, refs);
            }
          } else if (cb) {
            out += `<p>${cb.box}${parseInline(cb.rest, refs)}</p>\n`;
          } else {
            out += `<p>${parseInline(text, refs)}</p>\n`;
          }
        } else {
          renderNode(child);
        }
      }
      out += '</li>\n';
    } else if (node.t === 'hr') {
      out += '<hr>\n';
    } else if (node.t === 'table') {
      out += '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < node.head.length; i++) {
        const a = node.align[i];
        out += a ? `<th align="${a}">${parseInline(node.head[i], refs)}</th>\n` : `<th>${parseInline(node.head[i], refs)}</th>\n`;
      }
      out += '</tr>\n</thead>\n';
      if (node.rows.length > 0) {
        out += '<tbody>';
        for (const row of node.rows) {
          out += '<tr>\n';
          for (let i = 0; i < node.head.length; i++) {
            const cell = i < row.length ? row[i] : '';
            const a = node.align[i];
            out += a ? `<td align="${a}">${parseInline(cell, refs)}</td>\n` : `<td>${parseInline(cell, refs)}</td>\n`;
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
    }
  };
  // Mark items with their list's tightness before rendering.
  const markTight = (nodes) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.t === 'list') {
        for (const item of node.ch) {
          item._listTight = node.tight;
          markTight(item.ch);
        }
      } else if (node.ch) {
        markTight(node.ch);
      }
    }
  };
  markTight(root.ch);
  renderNodes(root.ch);
  return out;
}

// A leading task checkbox `[ ]`, `[x]` or `[X]` at the start of a list
// item's first paragraph. The marker itself is replaced by the input; the
// space after it stays in the content.
function extractCheckbox(text) {
  let p = 0;
  while (p < 3 && p < text.length && (text.charCodeAt(p) === CODE_SPACE || text.charCodeAt(p) === CODE_TAB)) p++;
  if (text.charCodeAt(p) !== CODE_LBRACKET) return null;
  const c = text.charCodeAt(p + 1);
  if (c !== CODE_SPACE && c !== 120 && c !== 88) return null;
  if (text.charCodeAt(p + 2) !== CODE_RBRACKET) return null;
  const after = p + 3 < text.length ? text.charCodeAt(p + 3) : -1;
  if (after !== -1 && after !== CODE_SPACE && after !== CODE_TAB && after !== CODE_LF) return null;
  const checked = c === 120 || c === 88;
  const box = checked
    ? '<input checked="" disabled="" type="checkbox">'
    : '<input disabled="" type="checkbox">';
  return { box, rest: text.slice(p + 3) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parse(input) {
  const { root, refs } = parseBlocks(input);
  return renderDoc(root, refs);
}
