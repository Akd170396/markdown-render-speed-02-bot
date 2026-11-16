// parse.js — a Markdown renderer whose parse() returns HTML byte-identical to
// marked 18.1.3 (default options) for every input, and faster than marked.
// Written from scratch from the CommonMark 0.31.2 + GFM 0.29 specs and the
// competition's practice cases. No dependencies, Node built-ins only.

// ---------- small helpers ----------

const PUNCT = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
function isPunct(ch) { return PUNCT.indexOf(ch) >= 0; }
function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'; }
function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\n'; }
function isAlphaNum(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isLetter(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isDigit(ch) { const c = ch.charCodeAt(0); return c >= 48 && c <= 57; }

// Named HTML entities (name -> character). Only used where marked decodes
// entities (link destinations and titles); in plain text marked leaves a
// valid-looking &name; reference untouched, so no table is needed there.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
  iexcl: '\u00a1', iquest: '\u00bf', cent: '\u00a2', pound: '\u00a3',
  curren: '\u00a4', yen: '\u00a5', brvbar: '\u00a6', sect: '\u00a7',
  uml: '\u00a8', ordf: '\u00aa', ordm: '\u00ba', para: '\u00b6',
  middot: '\u00b7', cedil: '\u00b8', sup1: '\u00b9', sup2: '\u00b2',
  sup3: '\u00b3', acute: '\u00b4', micro: '\u00b5', frac14: '\u00bc',
  frac12: '\u00bd', frac34: '\u00be', deg: '\u00b0', plusmn: '\u00b1',
  times: '\u00d7', divide: '\u00f7', minus: '\u2212', lowast: '\u2217',
  bull: '\u2022', dagger: '\u2020', Dagger: '\u2021', permil: '\u2030',
  prime: '\u2032', Prime: '\u2033', oline: '\u203e', frasl: '\u2044',
  euro: '\u20ac', weierp: '\u2118', image: '\u2111', real: '\u211c',
  alefsym: '\u2135', larr: '\u2190', uarr: '\u2191', rarr: '\u2192',
  darr: '\u2193', harr: '\u2194', crarr: '\u21b5', lArr: '\u21d0',
  uArr: '\u21d1', rArr: '\u21d2', dArr: '\u21d3', hArr: '\u21d4',
  forall: '\u2200', part: '\u2202', exist: '\u2203', empty: '\u2205',
  nabla: '\u2207', isin: '\u2208', notin: '\u2209', ni: '\u220b',
  prod: '\u220f', sum: '\u2211', infin: '\u221e', ang: '\u2220',
  and: '\u2227', or: '\u2228', cap: '\u2229', cup: '\u222a',
  int: '\u222b', there4: '\u2234', sim: '\u223c', cong: '\u2245',
  asymp: '\u2248', ne: '\u2260', equiv: '\u2261', le: '\u2264',
  ge: '\u2265', sub: '\u2282', sup: '\u2283', nsub: '\u2284',
  sube: '\u2286', supe: '\u2287', oplus: '\u2295', otimes: '\u2297',
  perp: '\u22a5', sdot: '\u22c5', lceil: '\u2308', rceil: '\u2309',
  lfloor: '\u230a', rfloor: '\u230b', lang: '\u27e8', rang: '\u27e9',
  loz: '\u25ca', spades: '\u2660', clubs: '\u2663', hearts: '\u2665',
  diams: '\u2666', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  zwnj: '\u200c', zwj: '\u200d', lrm: '\u200e', rlm: '\u200f',
  sbquo: '\u201a', bdquo: '\u201e', fnof: '\u0192', circ: '\u02c6',
  tilde: '\u02dc', Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393',
  Delta: '\u0394', Epsilon: '\u0395', Zeta: '\u0396', Eta: '\u0397',
  Theta: '\u0398', Iota: '\u0399', Kappa: '\u039a', Lambda: '\u039b',
  Mu: '\u039c', Nu: '\u039d', Xi: '\u039e', Omicron: '\u039f',
  Pi: '\u03a0', Rho: '\u03a1', Sigma: '\u03a3', Tau: '\u03a4',
  Upsilon: '\u03a5', Phi: '\u03a6', Chi: '\u03a7', Psi: '\u03a8',
  Omega: '\u03a9', alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3',
  delta: '\u03b4', epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7',
  theta: '\u03b8', iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb',
  mu: '\u03bc', nu: '\u03bd', xi: '\u03be', omicron: '\u03bf',
  pi: '\u03c0', rho: '\u03c1', sigmaf: '\u03c2', sigma: '\u03c3',
  tau: '\u03c4', upsilon: '\u03c5', phi: '\u03c6', chi: '\u03c7',
  psi: '\u03c8', omega: '\u03c9', thetasym: '\u03d1', upsih: '\u03d2',
  piv: '\u03d6', Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2',
  Atilde: '\u00c3', Auml: '\u00c4', Aring: '\u00c5', AElig: '\u00c6',
  Ccedil: '\u00c7', Egrave: '\u00c8', Eacute: '\u00c9', Ecirc: '\u00ca',
  Euml: '\u00cb', Igrave: '\u00cc', Iacute: '\u00cd', Icirc: '\u00ce',
  Iuml: '\u00cf', ETH: '\u00d0', Ntilde: '\u00d1', Ograve: '\u00d2',
  Oacute: '\u00d3', Ocirc: '\u00d4', Otilde: '\u00d5', Ouml: '\u00d6',
  Oslash: '\u00d8', Ugrave: '\u00d9', Uacute: '\u00da', Ucirc: '\u00db',
  Uuml: '\u00dc', Yacute: '\u00dd', THORN: '\u00de', szlig: '\u00df',
  agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3',
  auml: '\u00e4', aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7',
  egrave: '\u00e8', eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb',
  igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef',
  eth: '\u00f0', ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3',
  ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6', oslash: '\u00f8',
  ugrave: '\u00f9', uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc',
  yacute: '\u00fd', thorn: '\u00fe', yuml: '\u00ff', OElig: '\u0152',
  oelig: '\u0153', Scaron: '\u0160', scaron: '\u0161', Yuml: '\u0178',
  Dcaron: '\u010e', dcaron: '\u010f', HilbertSpace: '\u210b',
  DifferentialD: '\u2145', ClockwiseContourIntegral: '\u2232',
  ngE: '\u2267\u0338', NotEqualTilde: '\u2242\u0338', heartsuit: '\u2665',
};

// Decode a numeric character reference body (without the leading &# and
// trailing ;) to a string, or null when it is not a valid reference.
function decodeNumeric(body) {
  let cp;
  if (body[0] === 'x' || body[0] === 'X') {
    if (body.length < 2 || body.length > 7) return null;
    cp = parseInt(body.slice(1), 16);
    if (Number.isNaN(cp)) return null;
  } else {
    if (body.length < 1 || body.length > 7) return null;
    if (!/^\d+$/.test(body)) return null;
    cp = parseInt(body, 10);
  }
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(cp);
}

// Unescape a link destination or title: only numeric references are
// decoded (marked keeps &name; references as-is there); anything else
// stays literal.
function unescapeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf('&', i);
    if (amp < 0) { out += s.slice(i); break; }
    out += s.slice(i, amp);
    if (amp > 0 && s[amp - 1] === '\u0001') { out += '&'; i = amp + 1; continue; }
    const semi = s.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 33) { out += '&'; i = amp + 1; continue; }
    const body = s.slice(amp + 1, semi);
    if (body[0] === '#') {
      const dec = decodeNumeric(body.slice(1));
      if (dec !== null) { out += dec; i = semi + 1; continue; }
      out += '&'; i = amp + 1; continue;
    }
    out += '&'; i = amp + 1;
  }
  return out;
}

// Escape text content: < > " ' always; & unless it starts a reference that
// looks like &#digits; / &#xhex; / &word; (marked keeps those as-is, even
// when the named entity does not exist).
const ESCAPE_TEXT_RE = /(?:[<>"']|&(?!(?:#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|[A-Za-z0-9]+);))/g;
function escapeTextRaw(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render a plain-text token: resolve backslash-escape markers first (a
// character that came from a backslash escape never starts an entity, and
// an escaped & always renders as &amp;), then decode numeric references
// (a decoded character is then escaped like any other), then escape text.
function renderText(s) {
  if (s.indexOf('\u0001') >= 0) {
    s = s.replace(/\u0001&/g, '\u0002').replace(/\u0001(.)/g, '$1');
  }
  if (s.indexOf('&#') >= 0) {
    s = s.replace(/&#[Xx]([0-9A-Fa-f]{1,6});|&#(\d{1,7});/g, (m, hex, dec) => {
      const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(cp);
    });
  }
  s = s.replace(ESCAPE_TEXT_RE, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return '&#39;';
  });
  if (s.indexOf('\u0002') >= 0) s = s.replace(/\u0002/g, '&amp;');
  return s;
}

// Escape with every & escaped (code spans, and attribute values that have
// already been unescaped).
function escapeAll(s) {
  return escapeTextRaw(s);
}

// Escape text without decoding numeric references: < > " ' always, and &
// unless it starts a reference that looks like &#digits; / &#xhex; /
// &word;. Used for link destinations, titles and fence info strings, where
// marked keeps entity-looking text as-is.
function escapeTextOnly(s) {
  return s.replace(ESCAPE_TEXT_RE, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return '&#39;';
  });
}

// Resolve backslash escapes in a short string (fence info word).
function unescapeBackslashes(s) {
  return s.replace(/\\([!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g, '$1');
}

// Block dangerous URL schemes the way marked's cleanUrl does. Returns the
// (unescaped) URL or null when it must not become a link.
function cleanUrl(url) {
  let u = url.replace(/^[\u0000-\u0020]+/, '');
  if (/^(?:javascript|vbscript|data):/i.test(u)) return null;
  return encodeURI(u).replace(/%25/g, '%');
}

// Normalize a link reference label: casefold and collapse whitespace runs.
function normalizeLabel(s) {
  // Unicode case folding maps ß and ẞ to "ss" (toLowerCase alone gives ß).
  return s.replace(/[ \t\r\n]+/g, ' ').trim().toLowerCase().replace(/[ßẞ]/g, 'ss');
}


// ---------- inline parsing ----------

// Token kinds: text, code, html, link, img, br, delim, em-open/close,
// strong-open/close, del-open/close, open (a '[' not yet resolved).

const PUNCT_RE = /\p{P}|\p{S}/u;
function isUnicodePunct(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return isPunct(ch);
  return PUNCT_RE.test(ch);
}
function isUnicodeSpace(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
  return /\s/.test(ch);
}

// Flanking info for a delimiter run.
function flanking(prevCh, nextCh) {
  const prevWs = prevCh === '' ? true : isUnicodeSpace(prevCh);
  const nextWs = nextCh === '' ? true : isUnicodeSpace(nextCh);
  const prevPu = prevCh === '' ? false : isUnicodePunct(prevCh);
  const nextPu = nextCh === '' ? false : isUnicodePunct(nextCh);
  const left = !nextWs && (!nextPu || prevWs || prevPu);
  const right = !prevWs && (!prevPu || nextWs || nextPu);
  return { left, right };
}

// Text content of a token, used for flanking decisions and alt text.
function tokenText(tok) {
  switch (tok.t) {
    case 'text': return tok.s;
    case 'code': return tok.s;
    case 'html': return tok.s;
    case 'link': return tok.plain;
    case 'img': return tok.alt;
    case 'br': return '\n';
    case 'delim': return tok.ch.repeat(tok.n);
    case 'open': return tok.s;
    default: return '';
  }
}
function tokenFirstChar(tok) {
  const s = tokenText(tok);
  for (let k = 0; k < s.length; k++) {
    if (s[k] !== '\u0001' && s[k] !== '\u0002') return s[k];
  }
  return '';
}
function tokenLastChar(tok) {
  const s = tokenText(tok);
  for (let k = s.length - 1; k >= 0; k--) {
    if (s[k] !== '\u0001' && s[k] !== '\u0002') return s[k];
  }
  return '';
}

// Parse a link destination + optional title starting just after '('.
// src is the inline source, j is the index just after '('. Returns
// { href, title, end } (end = index just after the closing ')') or null.
function parseInlineDest(src, j) {
  const len = src.length;
  let k = j;
  while (k < len && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n')) k++;
  let href = '';
  if (k < len && src[k] === '<') {
    let m = k + 1;
    let ok = false;
    while (m < len) {
      const ch = src[m];
      if (ch === '\n' || ch === '<') break;
      if (ch === '>') { ok = true; break; }
      if (ch === '\\' && m + 1 < len && isPunct(src[m + 1])) { href += src[m + 1]; m += 2; continue; }
      href += ch; m++;
    }
    if (!ok) return null;
    k = m + 1;
  } else {
    let depth = 0;
    let m = k;
    while (m < len) {
      const ch = src[m];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch.charCodeAt(0) < 32) break;
      if (ch === '\\' && m + 1 < len && isPunct(src[m + 1])) { href += src[m + 1]; m += 2; continue; }
      if (ch === '(') { depth++; href += ch; m++; continue; }
      if (ch === ')') {
        if (depth === 0) break;
        depth--; href += ch; m++; continue;
      }
      href += ch; m++;
    }
    k = m;
  }
  // Optional title, then ')'.
  let save = k;
  while (k < len && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n')) k++;
  let title = null;
  if (k < len && (src[k] === '"' || src[k] === "'" || src[k] === '(')) {
    const q = src[k];
    const close = q === '(' ? ')' : q;
    let m = k + 1;
    let t = '';
    let ok = false;
    let depth = 1;
    while (m < len) {
      const ch = src[m];
      if (ch === '\\' && m + 1 < len && isPunct(src[m + 1])) { t += src[m + 1]; m += 2; continue; }
      if (q === '(') {
        if (ch === '(') { depth++; t += ch; m++; continue; }
        if (ch === ')') { depth--; if (depth === 0) { ok = true; break; } t += ch; m++; continue; }
      } else if (ch === close) { ok = true; break; }
      t += ch; m++;
    }
    if (!ok) return null;
    title = t;
    k = m + 1;
    while (k < len && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n')) k++;
  }
  if (k >= len || src[k] !== ')') return null;
  return { href, title, end: k + 1 };
}

// Try to match an autolink <...> at src[i] === '<'. Returns a token or null.
function matchAutolink(src, i) {
  const len = src.length;
  let m = i + 1;
  // scheme:...>
  if (m < len && isLetter(src[m])) {
    let s = m;
    while (s < len && (isAlphaNum(src[s]) || src[s] === '+' || src[s] === '.' || src[s] === '-')) s++;
    if (s - m >= 2 && s - m <= 32 && s < len && src[s] === ':') {
      let e = s + 1;
      while (e < len && src[e] !== ' ' && src[e] !== '\t' && src[e] !== '\n' && src[e] !== '<' && src[e] !== '>') e++;
      if (e < len && src[e] === '>' && e > s + 1) {
        const text = src.slice(i + 1, e);
        return { t: 'link', href: encodeURI(text), title: null, plain: text, html: renderText(text), end: e + 1, auto: 'angle' };
      }
    }
  }
  // email>
  const emailRe = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+>/;
  const sub = src.slice(i + 1);
  const em = emailRe.exec(sub);
  if (em) {
    const text = em[0].slice(0, -1);
    return { t: 'link', href: 'mailto:' + text, title: null, plain: text, html: renderText(text), end: i + 1 + em[0].length, auto: 'angle' };
  }
  return null;
}

// Try to match raw HTML at src[i] === '<'. Returns { html, end } or null.
// A closing tag may not carry attributes; a quoted attribute value may
// contain any character except its quote, including a newline.
const HTML_OPEN_TAG_RE = /^<[A-Za-z][A-Za-z0-9-]*(?:[ \t\n]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t\n]*=[ \t\n]*(?:[^ \t\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\n]*\/?>/;
const HTML_CLOSE_TAG_RE = /^<\/[A-Za-z][A-Za-z0-9-]*[ \t\n]*>/;
const HTML_TAG_RE = HTML_OPEN_TAG_RE;
function matchHtml(src, i) {
  const rest = src.slice(i);
  if (rest.startsWith('<!--')) {
    const e = rest.indexOf('-->');
    if (e >= 0) return { html: rest.slice(0, e + 3), end: i + e + 3 };
    return null;
  }
  if (rest.startsWith('<?')) {
    const e = rest.indexOf('?>');
    if (e >= 0) return { html: rest.slice(0, e + 2), end: i + e + 2 };
    return null;
  }
  if (rest.startsWith('<![CDATA[')) {
    const e = rest.indexOf(']]>');
    if (e >= 0) return { html: rest.slice(0, e + 3), end: i + e + 3 };
    return null;
  }
  if (/^<![A-Za-z]/.test(rest)) {
    const e = rest.indexOf('>');
    if (e >= 0) return { html: rest.slice(0, e + 1), end: i + e + 1 };
    return null;
  }
  if (/^<!/.test(rest)) return null;
  const m = rest.startsWith('</') ? HTML_CLOSE_TAG_RE.exec(rest) : HTML_OPEN_TAG_RE.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  return null;
}

// Trim trailing punctuation from an extended autolink per the GFM rules.
function trimAutolinkEnd(s) {
  let end = s.length;
  while (end > 0) {
    const ch = s[end - 1];
    if (ch === '?' || ch === '!' || ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === '*' || ch === '_' || ch === '~') {
      // A trailing &...; sequence is not part of the autolink at all:
      // drop it entirely (the & and the name, not just the ';').
      if (ch === ';') {
        const amp = s.lastIndexOf('&', end - 1);
        if (amp >= 0 && /^[A-Za-z0-9]+$/.test(s.slice(amp + 1, end - 1))) { end = amp; continue; }
      }
      end--;
      continue;
    }
    if (ch === ')') {
      // Remove only when the parens in the string are unbalanced.
      let open = 0, close = 0;
      for (let k = 0; k < end; k++) { if (s[k] === '(') open++; else if (s[k] === ')') close++; }
      if (close > open) { end--; continue; }
    }
    break;
  }
  return s.slice(0, end);
}

// Try to match an extended autolink (www., scheme://, email) at src[i].
// Returns { t:'link', href, plain, end } or null.
// Inside a bracket link's text, an extended autolink must not swallow
// the ']' that closes the bracket when that ']' starts a link
// destination ('](' or ']['). Truncate the autolink text at the first
// such ']' so the bracket can close and the link can form. Outside
// brackets (or when ']' is not followed by '(' or '[') the ']' stays.
function truncateAtBracketClose(text) {
  for (let k = 0; k < text.length; k++) {
    if (text[k] === ']' && (text[k + 1] === '(' || text[k + 1] === '[')) return text.slice(0, k);
  }
  return text;
}
function matchExtendedAutolink(src, i, inBrackets) {
  // Suppressed while an unclosed <a> tag is open (document-wide state).
  if (inAnchor) return null;
  const rest = src.slice(i);
  // www.
  if (rest.startsWith('www.')) {
    const m = /^[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z0-9](?:[/?#][^\s<>]*)?/.exec(rest.slice(4));
    if (m) {
      let text = 'www.' + trimAutolinkEnd(m[0]);
      if (inBrackets) text = truncateAtBracketClose(text);
      if (!text || text === 'www.') return null;
      return { t: 'link', href: encodeURI('http://' + text), title: null, plain: text, html: renderText(text), end: i + text.length, auto: 'ext' };
    }
    return null;
  }
  // scheme://
  const sm = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):\/\/[^\s<>]+/.exec(rest);
  if (sm) {
    let text = trimAutolinkEnd(sm[0]);
    if (inBrackets) text = truncateAtBracketClose(text);
    if (!text) return null;
    return { t: 'link', href: encodeURI(text), title: null, plain: text, html: renderText(text), end: i + text.length, auto: 'ext' };
  }
  // scheme:email (mailto:, xmpp:, ...) with an optional single path
  // segment. The scheme is 2-32 chars; the address must be an email.
  const scm = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):/.exec(rest);
  if (scm) {
    const after = rest.slice(scm[0].length);
    const em2 = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(after);
    if (em2) {
      // A domain ending in '-' or '_' is not a valid email.
      const nx = after[em2[0].length];
      if (nx === '-' || nx === '_') return null;
      let text = scm[0] + em2[0];
      const p = after.slice(em2[0].length);
      const pm = /^\/[^\s<>\/]+/.exec(p);
      if (pm) text += pm[0];
      text = trimAutolinkEnd(text);
      return { t: 'link', href: text, title: null, plain: text, html: renderText(text), end: i + text.length, auto: 'ext' };
    }
    // A scheme followed by a non-email is not an autolink; fall through
    // so the email part alone is not linked either (the scheme stays).
    return null;
  }
  // email (only at the start of a word)
  if (i === 0 || !/[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(src[i - 1])) {
    const em = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(rest);
    if (em) {
      // A domain ending in '-' or '_' is not a valid email: the whole
      // thing is literal, not a trimmed autolink.
      const nx = rest[em[0].length];
      if (nx === '-' || nx === '_') return null;
      const text = em[0];
      return { t: 'link', href: 'mailto:' + text, title: null, plain: text, html: renderText(text), end: i + text.length, auto: 'ext' };
    }
  }
  return null;
}


// Scan an inline string into tokens (links/images resolved, emphasis not yet).
// Document-wide anchor state: an opening <a ...> tag (with no closing
// </a> yet) suppresses extended autolinks (email, www., scheme://) in
// all following inline content, even across paragraphs and blocks, until
// a </a> appears. Bracket links and angle autolinks are unaffected.
// This mirrors marked's global link state. Reset at the start of parse().
let inAnchor = false;
function anchorTagState(html) {
  const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(html);
  if (!m || m[1].toLowerCase() !== 'a') return null;
  return html[1] === '/' ? 'close' : 'open';
}
function scanInline(src, defs) {
  const len = src.length;
  const tokens = [];
  const brackets = [];
  let i = 0;

  function pushText(s) {
    if (!s) return;
    const last = tokens[tokens.length - 1];
    if (last && last.t === 'text') last.s += s;
    else tokens.push({ t: 'text', s });
  }
  function pushDelim(ch, n) {
    tokens.push({ t: 'delim', ch, n, canOpen: false, canClose: false });
  }

  // Consume a run of plain text starting at i, stopping at the next
  // character that needs special handling.
  function consumeTextRun() {
    const start = i;
    while (i < len) {
      const ch = src[i];
      if (ch === '\\' || ch === '`' || ch === '*' || ch === '_' || ch === '[' || ch === ']' || ch === '<' || ch === '\n') break;
      if (ch === '!' && src[i + 1] === '[') break;
      if (ch === '~') break;
      if (ch === 'w' && src.startsWith('www.', i)) break;
      if (isLetter(ch) && (i === 0 || !(isAlphaNum(src[i - 1]) || src[i - 1] === '+' || src[i - 1] === '.' || src[i - 1] === '-'))) {
        const colon = src.indexOf('://', i);
        if (colon > i + 1 && colon - i <= 32) {
          let ok = true;
          for (let k = i + 1; k < colon; k++) {
            const cc = src[k];
            if (!(isAlphaNum(cc) || cc === '+' || cc === '.' || cc === '-')) { ok = false; break; }
          }
          if (ok) break;
        }
      }
      if (i === 0 || !/[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(src[i - 1])) {
        const at = src.indexOf('@', i);
        if (at > i && at - i <= 64) {
          const em = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(src.slice(i));
          // A domain ending in '-' or '_' is not a valid email autolink.
          if (em) {
            const nx = src[i + em[0].length];
            if (nx !== '-' && nx !== '_') break;
          }
        }
      }
      i++;
    }
    if (i > start) pushText(src.slice(start, i));
  }

  while (i < len) {
    const ch = src[i];
    if (ch === '\\') {
      if (i + 1 < len && src[i + 1] === '\n') {
        tokens.push({ t: 'br' }); i += 2;
        // A hard break strips the leading spaces/tabs of the next line.
        while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;
        continue;
      }
      if (i + 1 < len && isPunct(src[i + 1])) { pushText('\u0001' + src[i + 1]); i += 2; continue; }
      pushText('\\'); i++; continue;
    }
    if (ch === '`') {
      let n = 0;
      while (i + n < len && src[i + n] === '`') n++;
      // Find the next run of exactly n backticks.
      let j = i + n;
      let close = -1;
      while (j < len) {
        if (src[j] === '`') {
          let m = 0;
          while (j + m < len && src[j + m] === '`') m++;
          if (m === n) { close = j; break; }
          j += m;
        } else j++;
      }
      if (close < 0) { pushText('`'.repeat(n)); i += n; continue; }
      let content = src.slice(i + n, close).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      tokens.push({ t: 'code', s: content });
      i = close + n;
      continue;
    }
    if (ch === '<') {
      const auto = matchAutolink(src, i);
      if (auto) { tokens.push(auto); i = auto.end; continue; }
      const html = matchHtml(src, i);
      if (html) {
        const st = anchorTagState(html.html);
        if (st === 'open') inAnchor = true;
        else if (st === 'close') inAnchor = false;
        tokens.push({ t: 'html', s: html.html }); i = html.end; continue;
      }
      pushText('<'); i++; continue;
    }
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const isImg = ch === '!';
      const tok = { t: 'open', s: isImg ? '![' : '[', srcIndex: isImg ? i + 1 : i };
      tokens.push(tok);
      brackets.push(tok);
      i += isImg ? 2 : 1;
      continue;
    }
    if (ch === ']') {
      const openTok = brackets.pop();
      if (!openTok) { pushText(']'); i++; continue; }
      const oi = tokens.indexOf(openTok);
      const isImg = openTok.s === '![';
      // A link's text may not contain another (bracket) link; an
      // autolink inside does not block formation. An image's alt text
      // is plain text, so a link or image inside it does not block.
      let hasLink = false;
      if (!isImg) {
        for (let k = oi + 1; k < tokens.length; k++) {
          if (tokens[k].t === 'link' && !tokens[k].auto) { hasLink = true; break; }
        }
      }
      let formed = false;
      if (!hasLink) {
        const labelRaw = src.slice(openTok.srcIndex + 1, i);
        // Labels keep backslashes raw (no escape resolution).
        const labelText = labelRaw;
        let href = null, title = null, end = i + 1;
        const j = i + 1;
        if (src[j] === '(') {
          const d = parseInlineDest(src, j + 1);
          if (d) { href = unescapeEntities(d.href); title = d.title !== null ? unescapeEntities(d.title) : null; end = d.end; }
        }
        if (href === null && src[j] === '[') {
          let m = j + 1, label = '', ok = false;
          while (m < len) {
            if (src[m] === '\\' && m + 1 < len) { label += src[m] + src[m + 1]; m += 2; continue; }
            if (src[m] === ']') { ok = true; break; }
            label += src[m]; m++;
          }
          if (ok) {
            const key = label === '' ? normalizeLabel(labelText) : normalizeLabel(label);
            const def = defs.get(key);
            if (def) { href = def.href; title = def.title; end = m + 1; }
          }
        }
        if (href === null && src[j] !== '[') {
          // Shortcut reference: also the fallback when an inline
          // destination failed to parse. A failed full reference does
          // NOT fall back to the shortcut.
          const def = defs.get(normalizeLabel(labelText));
          if (def) { href = def.href; title = def.title; end = i + 1; }
        }
        if (href !== null) {
          const clean = cleanUrl(href);
          if (clean !== null) {
            const sub = tokens.slice(oi + 1);
            // An extended autolink inside a link's text becomes plain
            // text; an angle-bracket autolink stays a (nested) link.
            for (let k = 0; k < sub.length; k++) {
              if (sub[k].t === 'link' && sub[k].auto === 'ext') sub[k] = { t: 'text', s: sub[k].plain };
            }
            resolveDelimiters(sub);
            const textHtml = renderTokens(sub);
            const plain = plainTextOf(sub);
            const linkTok = openTok.s === '!['
              ? { t: 'img', src: clean, title, alt: plain, plain }
              : { t: 'link', href: clean, title, plain, html: textHtml };
            tokens.splice(oi, tokens.length - oi, linkTok);
            i = end;
            formed = true;
          }
        }
      }
      if (!formed) {
        openTok.t = 'text'; openTok.s = openTok.s;
        pushText(']');
        i++;
      }
      continue;
    }
    if (ch === '*' || ch === '_') {
      let n = 0;
      while (i + n < len && src[i + n] === ch) n++;
      pushDelim(ch, n);
      i += n;
      continue;
    }
    if (ch === '~') {
      let n = 0;
      while (i + n < len && src[i + n] === '~') n++;
      pushDelim('~', n);
      i += n;
      continue;
    }
    if (ch === '\n') {
      const last = tokens[tokens.length - 1];
      if (last && last.t === 'text' && / {2,}$/.test(last.s)) {
        last.s = last.s.replace(/ {2,}$/, '');
        if (last.s === '') tokens.pop();
        tokens.push({ t: 'br' });
        i++;
        // A hard break strips the leading spaces/tabs of the next line.
        while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;
      } else {
        pushText('\n');
        i++;
      }
      continue;
    }
    if (ch === 'w' && src.startsWith('www.', i)) {
      const auto = matchExtendedAutolink(src, i, brackets.length > 0);
      if (auto) { tokens.push(auto); i = auto.end; continue; }
    }
    if (isLetter(ch)) {
      const auto = matchExtendedAutolink(src, i, brackets.length > 0);
      if (auto) { tokens.push(auto); i = auto.end; continue; }
    }
    const before = i;
    consumeTextRun();
    // Safety net: if the text run consumed nothing (a lookahead said
    // "special" but the matcher declined), consume one char as text so
    // the scanner always makes progress.
    if (i === before && i < len) { pushText(src[i]); i++; }
  }
  return tokens;
}

// Compute canOpen/canClose for delimiter tokens from their neighbours.
function computeFlanking(tokens) {
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.t !== 'delim') continue;
    let prevCh = '';
    for (let k = idx - 1; k >= 0; k--) {
      const c = tokenLastChar(tokens[k]);
      if (c) { prevCh = c; break; }
      if (tokens[k].t === 'br') { prevCh = '\n'; break; }
    }
    let nextCh = '';
    for (let k = idx + 1; k < tokens.length; k++) {
      const c = tokenFirstChar(tokens[k]);
      if (c) { nextCh = c; break; }
      if (tokens[k].t === 'br') { nextCh = '\n'; break; }
    }
    const f = flanking(prevCh, nextCh);
    if (tok.ch === '*') { tok.canOpen = f.left; tok.canClose = f.right; }
    else if (tok.ch === '~') { tok.canOpen = f.left; tok.canClose = f.right; }
    else { // '_'
      tok.canOpen = f.left && (!f.right || isUnicodePunct(prevCh));
      tok.canClose = f.right && (!f.left || isUnicodePunct(nextCh));
    }
  }
}

// Resolve emphasis / strikethrough delimiters (CommonMark delimiter-stack
// algorithm, outermost-first matching as marked does it).
function resolveDelimiters(tokens) {
  computeFlanking(tokens);
  const delims = [];
  for (const tok of tokens) if (tok.t === 'delim') delims.push(tok);
  for (const closer of delims) {
    // Strikethrough runs of 3+ tildes never form a del.
    if (closer.ch === '~' && closer.n > 2) continue;
    while (closer.n > 0 && closer.canClose) {
      const ci = tokens.indexOf(closer);
      if (ci < 0) break;
      let opener = null, oi = -1;
      // An opener inside an already-formed emphasis cannot pair with a
      // closer outside it (and vice versa): track the emphasis depth
      // while scanning backwards; only an opener at the closer's own
      // depth may pair.
      let depth = 0;
      for (let k = ci - 1; k >= 0; k--) {
        const cand = tokens[k];
        if (/^(em|strong|del)-close$/.test(cand.t)) { depth++; continue; }
        if (/^(em|strong|del)-open$/.test(cand.t)) { depth--; continue; }
        if (cand.t !== 'delim' || cand.ch !== closer.ch || !cand.canOpen || cand.n === 0) continue;
        if (depth !== 0) continue;
        // Strikethrough: the two runs must match exactly (1 or 2).
        if (closer.ch === '~' && cand.n !== closer.n) continue;
        if ((cand.ch === '*' || cand.ch === '_') && ((cand.canOpen && cand.canClose) || (closer.canOpen && closer.canClose))) {
          if ((cand.n + closer.n) % 3 === 0 && (cand.n % 3 !== 0 || closer.n % 3 !== 0)) continue;
        }
        opener = cand; oi = k;
        break;
      }
      if (!opener) break;
      // Nothing between opener and closer (apart from markers) -> no match.
      let hasContent = false;
      for (let k = oi + 1; k < ci; k++) {
        if (tokens[k].t !== 'delim' || tokens[k].n > 0) { hasContent = true; break; }
        if (/^(em|strong|del)-(open|close)$/.test(tokens[k].t)) { hasContent = true; break; }
      }
      if (!hasContent) {
        // Mark this opener unusable for this closer and look further back.
        opener.canOpen = false;
        continue;
      }
      const use = opener.ch === '~' ? opener.n : ((opener.n >= 2 && closer.n >= 2) ? 2 : 1);
      const kind = opener.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
      tokens.splice(ci, 0, { t: kind + '-close' });
      tokens.splice(oi + 1, 0, { t: kind + '-open' });
      opener.n -= use;
      closer.n -= use;
    }
  }
  // Leftover delimiters become literal text.
  for (const tok of tokens) {
    if (tok.t === 'delim') { tok.t = 'text'; tok.s = tok.ch.repeat(tok.n); delete tok.ch; delete tok.n; }
  }
}

// Plain text of a resolved token list (for image alt text).
function plainTextOf(tokens) {
  let out = '';
  for (const tok of tokens) {
    if (tok.t === 'text' || tok.t === 'code' || tok.t === 'html') out += tok.s;
    else if (tok.t === 'link' || tok.t === 'img') out += tok.plain;
    else if (tok.t === 'br') out += '\n';
  }
  return out;
}

// Render a resolved token list to HTML.
function renderTokens(tokens) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.t) {
      case 'text': out += renderText(tok.s); break;
      case 'open': out += renderText(tok.s); break;
      case 'code': out += '<code>' + escapeAll(tok.s) + '</code>'; break;
      case 'html': out += tok.s; break;
      case 'br': out += '<br>'; break;
      case 'link': {
        out += '<a href="' + escapeTextOnly(tok.href) + '"';
        if (tok.title !== null && tok.title !== undefined) out += ' title="' + escapeTextOnly(tok.title) + '"';
        out += '>' + tok.html + '</a>';
        break;
      }
      case 'img': {
        out += '<img src="' + escapeTextOnly(tok.src) + '" alt="' + renderText(tok.alt) + '"';
        if (tok.title !== null && tok.title !== undefined) out += ' title="' + escapeTextOnly(tok.title) + '"';
        out += '>';
        break;
      }
      case 'em-open': out += '<em>'; break;
      case 'em-close': out += '</em>'; break;
      case 'strong-open': out += '<strong>'; break;
      case 'strong-close': out += '</strong>'; break;
      case 'del-open': out += '<del>'; break;
      case 'del-close': out += '</del>'; break;
      default: break;
    }
  }
  return out;
}

// Parse inline Markdown to HTML.
function parseInline(src, defs) {
  if (src === '') return '';
  const tokens = scanInline(src, defs);
  resolveDelimiters(tokens);
  return renderTokens(tokens);
}


// ---------- block parsing ----------
// A line is { s: string, b: number, nl: boolean }: s is the line text, b is
// the virtual column of s[0] (tabs count by alignment from the line start,
// so a tab's width is 4 - (column % 4)), nl is whether the line was
// followed by a newline in the source.

function stripColsStr(s, b, n) {
  let col = b, i = 0;
  while (n > 0 && i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; col++; n--; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (w <= n) { i++; col += w; n -= w; }
      else return { s: ' '.repeat(w - n) + s.slice(i + 1), b: col + n };
    } else break;
  }
  return { s: s.slice(i), b: col };
}
function stripCols(L, n) {
  const r = stripColsStr(L.s, L.b, n);
  return { s: r.s, b: r.b, nl: L.nl };
}
function lineIndent(L) {
  let col = L.b, i = 0;
  while (i < L.s.length) {
    const ch = L.s[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return { cols: col - L.b, pos: i };
}
function isBlankLine(L) {
  for (let i = 0; i < L.s.length; i++) {
    const ch = L.s[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}
function restAfterIndent(L) {
  const ind = lineIndent(L);
  return { ind, rest: L.s.slice(ind.pos) };
}

// Parse a destination + optional title at s[k] (no surrounding parens).
// Returns { href, title, end } or null.
function parseDestAndTitle(s, k) {
  const len = s.length;
  while (k < len && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  if (k >= len) return null;
  let href = '';
  if (s[k] === '<') {
    let m = k + 1, ok = false;
    while (m < len) {
      const ch = s[m];
      if (ch === '\n' || ch === '<') break;
      if (ch === '>') { ok = true; break; }
      if (ch === '\\' && m + 1 < len && isPunct(s[m + 1])) { href += s[m + 1] === '&' ? '\u0001&' : s[m + 1]; m += 2; continue; }
      href += ch; m++;
    }
    if (!ok) return null;
    k = m + 1;
  } else {
    let depth = 0, m = k;
    while (m < len) {
      const ch = s[m];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch.charCodeAt(0) < 32) break;
      if (ch === '\\' && m + 1 < len && isPunct(s[m + 1])) { href += s[m + 1] === '&' ? '\u0001&' : s[m + 1]; m += 2; continue; }
      if (ch === '(') { depth++; href += ch; m++; continue; }
      if (ch === ')') {
        if (depth === 0) break;
        depth--; href += ch; m++; continue;
      }
      href += ch; m++;
    }
    if (m === k) return null;
    k = m;
  }
  const destEnd = k;
  let title = null;
  let save = k;
  while (k < len && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  if (k > save && k < len && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
    const q = s[k];
    const close = q === '(' ? ')' : q;
    let m = k + 1, t = '', ok = false, depth = 1;
    while (m < len) {
      const ch = s[m];
      if (ch === '\\' && m + 1 < len && isPunct(s[m + 1])) { t += s[m + 1] === '&' ? '\u0001&' : s[m + 1]; m += 2; continue; }
      if (q === '(') {
        if (ch === '(') { depth++; t += ch; m++; continue; }
        if (ch === ')') { depth--; if (depth === 0) { ok = true; break; } t += ch; m++; continue; }
      } else if (ch === close) { ok = true; break; }
      t += ch; m++;
    }
    if (!ok) return null;
    title = t;
    k = m + 1;
  } else {
    k = save;
  }
  return { href, title, end: k, destEnd };
}

function matchFence(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return null;
  const m = /^(`{3,}|~{3,})/.exec(rest);
  if (!m) return null;
  const ch = m[1][0], len = m[1].length;
  const info = rest.slice(len).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (ch === '`' && info.indexOf('`') >= 0) return null;
  return { ch, len, info, ind: ind.cols };
}
function isClosingFence(L, ch, len) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return false;
  const m = new RegExp('^\\' + ch + '{' + len + ',}[ \\t]*$').exec(rest);
  return !!m;
}
function matchAtx(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return null;
  const m = /^(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(rest);
  if (!m) return null;
  let content = m[2] === undefined ? '' : m[2];
  content = content.replace(/[ \t]+$/, '');
  if (/^#+$/.test(content)) content = '';
  else content = content.replace(/[ \t]+#+$/, '');
  return { level: m[1].length, content };
}
function isHrLine(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return false;
  return /^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(rest);
}
function matchSetext(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return null;
  const m = /^(=+|-+)[ \t]*$/.exec(rest);
  if (!m) return null;
  return m[1][0] === '=' ? 1 : 2;
}
function matchBlockquote(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3 || rest[0] !== '>') return null;
  const after = { s: rest.slice(1), b: L.b + ind.cols + 1, nl: L.nl };
  return stripCols(after, 1);
}
const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));
// HTML block start. Returns { type, tag } or null.
function matchHtmlStart(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return null;
  const lower = rest.toLowerCase();
  let m = /^<(script|pre|style|textarea)(?:[ \t>]|$)/.exec(lower);
  if (m) return { type: 1, tag: m[1] };
  if (lower.startsWith('<!--')) return { type: 2 };
  if (lower.startsWith('<?')) return { type: 3 };
  if (/^<![a-z]/.test(lower)) return { type: 4 };
  if (lower.startsWith('<![cdata[')) return { type: 5 };
  m = /^<\/?([a-z][a-z0-9-]*)(?:[ \t/>]|$)/.exec(lower);
  if (m && BLOCK_TAGS.has(m[1])) return { type: 6, tag: m[1] };
  // Type 7: a complete tag alone on the line.
  const tag = rest.startsWith('</') ? HTML_CLOSE_TAG_RE.exec(rest) : HTML_OPEN_TAG_RE.exec(rest);
  if (tag && rest.slice(tag[0].length).trim() === '') return { type: 7 };
  return null;
}
function matchListMarker(L) {
  const ind = lineIndent(L);
  if (ind.cols > 3) return null;
  const rest = L.s.slice(ind.pos);
  const base = L.b + ind.cols;
  let type = null, markerWidth = 0, start = 0, delim = '';
  let m = /^([-+*])/.exec(rest);
  if (m) { type = 'bullet'; markerWidth = 1; }
  else {
    m = /^(\d{1,9})([.)])/.exec(rest);
    if (m) { type = 'ordered'; markerWidth = m[1].length + 1; start = parseInt(m[1], 10); delim = m[2]; }
  }
  if (!type) return null;
  const after = rest.slice(markerWidth);
  // Whitespace after the marker.
  let k = 0, col = base + markerWidth, wsCols = 0;
  while (k < after.length && (after[k] === ' ' || after[k] === '\t')) {
    if (after[k] === ' ') { col++; wsCols++; k++; }
    else { const w = 4 - (col % 4); col += w; wsCols += w; k++; }
  }
  if (wsCols === 0 && k < after.length) return null;
  const contentEmpty = k >= after.length;
  const extra = (wsCols === 0 || wsCols >= 5 || contentEmpty) ? 1 : wsCols;
  const contentIndent = ind.cols + markerWidth + extra;
  const content = stripColsStr(after, base + markerWidth, extra);
  content.nl = L.nl;
  return { type, markerWidth, start, delim, contentIndent, content, indent: ind.cols, bullet: type === 'bullet' ? rest[0] : '' };
}
function splitTableRow(s) {
  let t = s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (t.startsWith('|')) t = t.slice(1);
  // A trailing '|' is the row's closing pipe unless escaped by an odd
  // number of backslashes (\\| is a literal backslash + a real pipe).
  if (t.endsWith('|')) {
    let bs = 0;
    for (let k = t.length - 2; k >= 0 && t[k] === '\\'; k--) bs++;
    if (bs % 2 === 0) t = t.slice(0, -1);
  }
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    // \| is an escaped pipe (not a separator; the backslash is dropped),
    // \\ is an escaped backslash (a following | IS a separator).
    if (ch === '\\' && i + 1 < t.length && (t[i + 1] === '|' || t[i + 1] === '\\')) { cur += t[i + 1]; i++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
}
function matchTableDelim(L) {
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3) return null;
  const cells = splitTableRow(rest);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const c of cells) {
    const m = /^(:?)-+(:?)$/.exec(c);
    if (!m) return null;
    aligns.push(m[1] && m[2] ? 'center' : m[2] ? 'right' : m[1] ? 'left' : null);
  }
  return aligns;
}

// Try to parse a link reference definition starting at lines[i].
// Returns { consumed, label, href, title } or null.
function tryParseDef(lines, i, defs) {
  const L = lines[i];
  const { ind, rest } = restAfterIndent(L);
  if (ind.cols > 3 || rest[0] !== '[') return null;
  // Join following lines so the label, destination or title may sit on a
  // later line; a blank line ends the definition.
  let text = rest;
  let linesUsed = 1;
  for (let k = 1; k <= 9 && i + k < lines.length; k++) {
    if (isBlankLine(lines[i + k])) break;
    text += '\n' + lines[i + k].s;
    linesUsed = k + 1;
  }
  // A label ends at the FIRST unescaped ']' (nested brackets do not
  // extend it) and keeps backslashes raw: escapes are not resolved in
  // labels, so [foo\!] does not match a [foo!] definition. A label may
  // not contain an unescaped '['.
  let k = 0, label = '', closed = -1;
  for (k = 1; k < text.length; k++) {
    const c = text[k];
    if (c === '\\' && k + 1 < text.length) { label += c + text[k + 1]; k++; continue; }
    if (c === '[') return null;
    if (c === ']') { closed = k; break; }
    label += c;
  }
  if (closed < 0 || label === '' || label.length > 999) return null;
  const key = normalizeLabel(label);
  if (key === '') return null;
  let m = closed + 1;
  while (m < text.length && (text[m] === ' ' || text[m] === '\t')) m++;
  if (text[m] !== ':') return null;
  m++;
  let d = parseDestAndTitle(text, m);
  if (!d) return null;
  // After the title only whitespace may follow on its line. When a title
  // is present but junk follows it, the definition still holds without
  // the title (the title's line becomes a paragraph).
  let e = d.end;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  if (e < text.length && text[e] !== '\n') {
    if (d.title === null) return null;
    d = { href: d.href, title: null, end: d.destEnd, destEnd: d.destEnd };
    e = d.end;
    while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
    if (e < text.length && text[e] !== '\n') return null;
  }
  const consumed = text.slice(0, e).split('\n').length;
  if (consumed > linesUsed) return null;
  if (!defs.has(key)) defs.set(key, { href: unescapeEntities(d.href), title: d.title !== null ? unescapeEntities(d.title) : null });
  return { consumed, label: key };
}


// Does a line start a block that can interrupt a paragraph (other than a
// fenced code block, which callers check separately)?
function isBlockStartLine(L) {
  if (matchAtx(L) || isHrLine(L) || matchBlockquote(L) || matchListMarker(L) || matchSetext(L)) return true;
  const h = matchHtmlStart(L);
  return !!h && h.type !== 7;
}

// Lightweight tracker: does a sequence of block lines end with an open
// paragraph? Used to decide lazy continuation lines.
function makeTracker() {
  return { inFence: false, fenceCh: '', fenceLen: 0, inPara: false, lastBlank: true, inCode: false };
}
function trackerUpdate(tr, L) {
  // Strip nested blockquote/list markers: a lazy line after a nested
  // container continues the innermost paragraph, so track the innermost
  // content.
  let cur = L;
  while (true) {
    const bq = matchBlockquote(cur);
    if (bq) { cur = bq; continue; }
    const m = matchListMarker(cur);
    if (m) { cur = m.content; continue; }
    break;
  }
  L = cur;
  if (isBlankLine(L)) { tr.lastBlank = true; tr.inCode = false; tr.inPara = false; return; }
  if (tr.inFence) {
    if (isClosingFence(L, tr.fenceCh, tr.fenceLen)) tr.inFence = false;
    tr.inPara = false; tr.lastBlank = false; tr.inCode = false; return;
  }
  const f = matchFence(L);
  if (f) { tr.inFence = true; tr.fenceCh = f.ch; tr.fenceLen = f.len; tr.inPara = false; tr.lastBlank = false; tr.inCode = false; return; }
  const ind = lineIndent(L);
  if (!tr.inPara && ind.cols >= 4 && (tr.lastBlank || tr.inCode)) { tr.inCode = true; tr.inPara = false; tr.lastBlank = false; return; }
  if (isBlockStartLine(L)) { tr.inPara = false; tr.lastBlank = false; tr.inCode = false; return; }
  tr.inPara = true; tr.lastBlank = false; tr.inCode = false;
}

function parseFenced(lines, i) {
  const f = matchFence(lines[i]);
  let j = i + 1;
  const content = [];
  while (j < lines.length) {
    if (isClosingFence(lines[j], f.ch, f.len)) break;
    content.push(stripCols(lines[j], f.ind).s);
    j++;
  }
  const end = j < lines.length ? j + 1 : j;
  if (content.length > 0 && content[content.length - 1] === '') content.pop();
  let html = '<pre><code';
  if (f.info) html += ' class="language-' + escapeTextOnly(unescapeBackslashes(f.info.split(/[ \t]/)[0])) + '"';
  html += '>' + escapeAll(content.length ? content.join('\n') + '\n' : '') + '</code></pre>\n';
  return { html, end };
}
function parseIndentedCode(lines, i) {
  const content = [];
  let j = i, lastContent = i;
  while (j < lines.length) {
    const L = lines[j];
    if (isBlankLine(L)) { content.push(stripCols(L, 4).s); j++; continue; }
    const ind = lineIndent(L);
    if (ind.cols < 4) break;
    content.push(stripCols(L, 4).s);
    lastContent = j;
    j++;
  }
  content.length = lastContent - i + 1;
  return { html: '<pre><code>' + escapeAll(content.length ? content.join('\n') + '\n' : '') + '</code></pre>\n', end: lastContent + 1 };
}
function parseHtmlBlock(lines, i, topLevel) {
  const h = matchHtmlStart(lines[i]);
  const endTest = (idx) => {
    const s = lines[idx].s;
    if (h.type === 1) return new RegExp('</' + h.tag, 'i').test(s);
    if (h.type === 2) return s.indexOf('-->') >= 0;
    if (h.type === 3) return s.indexOf('?>') >= 0;
    if (h.type === 4) return s.indexOf('>') >= 0;
    if (h.type === 5) return s.indexOf(']]>') >= 0;
    return false;
  };
  let j = i;
  if (h.type <= 5) {
    while (j < lines.length) {
      if (endTest(j)) { j++; break; }
      j++;
    }
  } else {
    while (j < lines.length && !isBlankLine(lines[j])) j++;
  }
  let html = '';
  for (let k = i; k < j; k++) {
    html += lines[k].s;
    if (k + 1 < j) html += '\n';
    else if (lines[k].nl && j < lines.length && !isBlankLine(lines[j])) html += '\n';
    else if (topLevel && lines[k].nl && j >= lines.length) html += '\n';
  }
  return { html, end: j };
}
function parseTable(lines, i, defs, collect) {
  const headerCells = splitTableRow(lines[i].s.slice(lineIndent(lines[i]).pos));
  const aligns = matchTableDelim(lines[i + 1]);
  const rows = [];
  let j = i + 2;
  while (j < lines.length && (!isBlankLine(lines[j]) || lines[j].s.includes('\t'))) {
    // A line that starts a block (blockquote, list, heading, fence, hr,
    // html block, setext) ends the table; it is not a row. A
    // whitespace-only line holding a tab is an empty row, not a blank
    // line (a spaces-only line does end the table).
    if (isBlockStartLine(lines[j]) || matchFence(lines[j])) break;
    rows.push(splitTableRow(lines[j].s.slice(lineIndent(lines[j]).pos)));
    j++;
  }
  let out = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < headerCells.length; c++) {
    out += '<th' + (aligns[c] ? ' align="' + aligns[c] + '"' : '') + '>' + (collect ? '' : parseInline(headerCells[c], defs)) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (rows.length > 0) {
    out += '<tbody>';
    for (const row of rows) {
      out += '<tr>\n';
      for (let c = 0; c < headerCells.length; c++) {
        const cell = c < row.length ? row[c] : '';
        out += '<td' + (aligns[c] ? ' align="' + aligns[c] + '"' : '') + '>' + (collect ? '' : parseInline(cell, defs)) + '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody>';
  }
  out += '</table>\n';
  return { html: out, end: j };
}

function canInterruptParagraphList(lines, j, m, inList) {
  // An ordered list may interrupt a paragraph only when it starts with
  // 1 -- except inside a list item, where any start number interrupts.
  if (m.type === 'ordered' && m.start !== 1 && !inList) return false;
  if (m.content.s.trim() !== '') return true;
  let k = j + 1;
  while (k < lines.length) {
    if (isBlankLine(lines[k])) { k++; continue; }
    return lineIndent(lines[k]).cols >= m.contentIndent;
  }
  return false;
}

function parseParagraph(lines, i, defs, tight, firstCheckbox, collect, inList) {
  let j = i;
  while (j < lines.length) {
    const d = tryParseDef(lines, j, defs);
    if (!d) break;
    j += d.consumed;
  }
  if (j >= lines.length || isBlankLine(lines[j])) return { html: '', end: j, tableAt: -1 };
  const start = j;
  const para = [lines[j]];
  j++;
  let setextLevel = 0;
  let tableAt = -1;
  while (j < lines.length) {
    const L = lines[j];
    if (isBlankLine(L) && !L.keepSpace) break;
    if (L.endsPara) { para.push(L); j++; break; }
    const ind = lineIndent(L);
    if (ind.cols <= 3) {
      const st = matchSetext(L);
      if (st) { setextLevel = st; j++; break; }
      if (para.length === 1) {
        const al = matchTableDelim(L);
        if (al) {
          const headerCells = splitTableRow(para[0].s.slice(lineIndent(para[0]).pos));
          if (headerCells.length === al.length && !(L.lazy === 'bq' && para[0].lazy !== 'bq')) { tableAt = start; break; }
        }
      }
      // A line followed by a table delimiter starts a table, so it does not
      // continue this paragraph. A lazy line (gathered inside a blockquote
      // or list item) only breaks out when its cell count matches the
      // delimiter's column count.
      const nx = lines[j + 1];
      const nal = nx && !matchSetext(nx) ? matchTableDelim(nx) : null;
      if (nal) {
        if (!L.lazy) break;
        const hdrCells = splitTableRow(L.s.slice(ind.pos));
        if (hdrCells.length === nal.length) break;
      }
      if (matchAtx(L) || matchFence(L) || isHrLine(L) || matchBlockquote(L)) break;
      const h = matchHtmlStart(L);
      if (h && h.type !== 7) break;
      const m = matchListMarker(L);
      if (m && !L.lazy && canInterruptParagraphList(lines, j, m, inList)) break;
    }
    para.push(L);
    j++;
  }
  if (tableAt >= 0) return { html: '', end: start, tableAt };
  const text = para.map((L) => L.s).join('\n');
  if (setextLevel) {
    const trimmed = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    return { html: '<h' + setextLevel + '>' + (collect ? '' : parseInline(trimmed, defs)) + '</h' + setextLevel + '>\n', end: j, tableAt: -1 };
  }
  if (firstCheckbox) {
    const cb = /^\[([ xX])\](?:[ \t]+([\s\S]*)|[ \t]*)$/.exec(text);
    if (cb) {
      const checked = cb[1] === 'x' || cb[1] === 'X';
      const rest = cb[2] === undefined ? '' : cb[2];
      const input = checked ? '<input checked="" disabled="" type="checkbox">' : '<input disabled="" type="checkbox">';
      const inner = input + (rest ? ' ' + (collect ? '' : parseInline(rest, defs)) : '');
      return { html: tight ? inner : '<p>' + inner + '</p>\n', end: j, tableAt: -1 };
    }
  }
  const inner = collect ? '' : parseInline(text, defs);
  return { html: tight ? inner : '<p>' + inner + '</p>\n', end: j, tableAt: -1 };
}

function parseBlockquote(lines, i, defs, collect) {
  const inner = [];
  const tr = makeTracker();
  let j = i;
  while (j < lines.length) {
    const L = lines[j];
    const bq = matchBlockquote(L);
    if (bq) {
      inner.push(bq);
      trackerUpdate(tr, bq);
      j++;
      continue;
    }
    if (isBlankLine(L)) break;
    if (tr.inPara && !matchFence(L)) {
      // A lazy '=' setext underline is kept as paragraph text by indenting
      // it four spaces, so it cannot turn the paragraph into a heading.
      if (matchSetext(L) === 1) {
        const indented = { s: '    ' + L.s, b: 0, nl: L.nl };
        inner.push(indented);
        trackerUpdate(tr, indented);
        j++;
        continue;
      }
      if (!isBlockStartLine(L)) {
        const ind = lineIndent(L);
        const base = ind.cols >= 4 ? stripCols(L, 4) : L;
        const lazyLine = { ...base, lazy: 'bq' };
        inner.push(lazyLine);
        trackerUpdate(tr, lazyLine);
        j++;
        continue;
      }
    }
    break;
  }
  const lastInner = inner[inner.length - 1];
  if (lastInner && lastInner.s !== '' && isBlankLine(lastInner)) lastInner.keepSpace = true;
  const innerParsed = parseBlocks(inner, defs, false, false, collect, false, false);
  return { html: '<blockquote>\n' + innerParsed.html + '</blockquote>\n', end: j };
}

function collectListItem(lines, start, marker) {
  const itemLines = [];
  const tr = makeTracker();
  itemLines.push(marker.content);
  trackerUpdate(tr, marker.content);
  let sawContent = marker.content.s.trim() !== '';
  let blankPending = false;
  let loose = false;
  let trailingBlanks = 0;
  let end = start + 1;
  let j = start + 1;
  while (j < lines.length) {
    const L = lines[j];
    if (isBlankLine(L)) { trailingBlanks++; j++; continue; }
    // Inside a fenced code block, content lines belong to the item
    // regardless of indentation (a fence's content need not be indented
    // to the list content level); the fence closes on its own line.
    if (tr.inFence) {
      if (trailingBlanks > 0) {
        for (let b = 0; b < trailingBlanks; b++) itemLines.push({ s: '', b: 0, nl: lines[j - trailingBlanks + b].nl });
        trailingBlanks = 0;
      }
      let stripped = stripCols(L, marker.contentIndent);
      while (stripped.s.startsWith('\t')) {
        const w = 4 - (stripped.b % 4);
        stripped = { s: ' '.repeat(w) + stripped.s.slice(1), b: stripped.b + w, nl: stripped.nl };
      }
      itemLines.push(stripped);
      trackerUpdate(tr, stripped);
      sawContent = true;
      end = j + 1;
      j++;
      continue;
    }
    const ind = lineIndent(L);
    if (ind.cols >= marker.contentIndent) {
      if (!sawContent && trailingBlanks > 0) break;
      if (trailingBlanks > 0) {
        if (sawContent && !tr.inFence) loose = true;
        for (let b = 0; b < trailingBlanks; b++) itemLines.push({ s: '', b: 0, nl: lines[j - trailingBlanks + b].nl });
        trailingBlanks = 0;
      }
      let stripped = stripCols(L, marker.contentIndent);
      // A tab at the start of a list item's content line is expanded
      // to spaces at its column (a fenced block's own indent strip
      // does not expand it, so this lives here, not in stripCols).
      while (stripped.s.startsWith('\t')) {
        const w = 4 - (stripped.b % 4);
        stripped = { s: ' '.repeat(w) + stripped.s.slice(1), b: stripped.b + w, nl: stripped.nl };
      }
      itemLines.push(stripped);
      trackerUpdate(tr, stripped);
      sawContent = true;
      end = j + 1;
      j++;
      continue;
    }
    if (isHrLine(L)) break;
    const m2 = matchListMarker(L);
    if (m2) break;
    if (trailingBlanks > 0) break;
    if (tr.inPara && !matchFence(L)) {
      // A lazy '=' setext underline stays literal text and ends the
      // paragraph; the next line starts a new paragraph inside the item.
      if (matchSetext(L) === 1) {
        itemLines.push({ ...L, lazy: 'li', endsPara: true });
        trackerUpdate(tr, L);
        sawContent = true;
        end = j + 1;
        j++;
        continue;
      }
      if (!isBlockStartLine(L)) {
        const ind2 = lineIndent(L);
        const base = ind2.cols >= 4 ? stripCols(L, 4) : L;
        itemLines.push({ ...base, lazy: 'li' });
        trackerUpdate(tr, base);
        sawContent = true;
        end = j + 1;
        j++;
        continue;
      }
    }
    break;
  }
  return { lines: itemLines, end, trailingBlanks, loose };
}

function parseList(lines, i, defs, collect) {
  const first = matchListMarker(lines[i]);
  const items = [];
  let j = i;
  let loose = false;
  while (j < lines.length) {
    if (isHrLine(lines[j])) break;
    const m = matchListMarker(lines[j]);
    if (!m || m.type !== first.type) break;
    if (first.type === 'ordered' && m.delim !== first.delim) break;
    if (first.type === 'bullet' && m.bullet !== first.bullet) break;
    const item = collectListItem(lines, j, m);
    items.push(item);
    j = item.end;
    let b = 0;
    while (j + b < lines.length && isBlankLine(lines[j + b])) b++;
    if (b > 0) {
      const nx = lines[j + b];
      const nm = nx ? matchListMarker(nx) : null;
      if (nm && nm.type === first.type && (first.type !== 'ordered' || nm.delim === first.delim) && (first.type !== 'bullet' || nm.bullet === first.bullet)) {
        loose = true;
        j += b;
        continue;
      }
      break;
    }
  }
  // An item loosens its list only when its own top-level blocks are
  // separated by a blank line; a blank inside a nested block does not.
  for (const item of items) {
    const probe = parseBlocks(item.lines, defs, true, true, true, false, true);
    if (probe.loose) { loose = true; break; }
  }
  let out = first.type === 'bullet' ? '<ul>\n' : (first.start !== 1 ? '<ol start="' + first.start + '">\n' : '<ol>\n');
  const tight = !loose;
  for (const item of items) {
    const parsed = parseBlocks(item.lines, defs, tight, true, collect, false, true);
    out += '<li>' + parsed.html + '</li>\n';
  }
  out += first.type === 'bullet' ? '</ul>\n' : '</ol>\n';
  return { html: out, end: j };
}

function parseBlocks(lines, defs, tight, firstCheckbox, collect, topLevel, inList) {
  let out = '';
  let seenBlock = false;
  let seenBlankAfterBlock = false;
  let loose = false;
  let i = 0;
  let first = true;
  while (i < lines.length) {
    const L = lines[i];
    if (isBlankLine(L)) {
      if (seenBlock) seenBlankAfterBlock = true;
      i++;
      continue;
    }
    const d = tryParseDef(lines, i, defs);
    if (d) {
      // A definition is a block-level element: a blank line before or
      // after it loosens its container, even though it renders nothing.
      if (seenBlankAfterBlock) loose = true;
      seenBlankAfterBlock = false;
      seenBlock = true;
      i += d.consumed;
      continue;
    }
    let res = null;
    const ind = lineIndent(L);
    if (ind.cols >= 4) {
      res = parseIndentedCode(lines, i);
    } else {
      const f = matchFence(L);
      if (f) res = parseFenced(lines, i);
      else {
        const atx = matchAtx(L);
        if (atx) res = { html: '<h' + atx.level + '>' + (collect ? '' : parseInline(atx.content, defs)) + '</h' + atx.level + '>\n', end: i + 1 };
        else if (isHrLine(L)) res = { html: '<hr>\n', end: i + 1 };
        else if (matchBlockquote(L)) res = parseBlockquote(lines, i, defs, collect);
        else if (matchListMarker(L)) res = parseList(lines, i, defs, collect);
        else {
          const h = matchHtmlStart(L);
          if (h) res = parseHtmlBlock(lines, i, topLevel);
        }
      }
    }
    if (!res) {
      const p = parseParagraph(lines, i, defs, tight, first && firstCheckbox, collect, inList);
      if (p.tableAt >= 0) {
        res = parseTable(lines, p.tableAt, defs, collect);
      } else {
        res = { html: p.html, end: p.end };
      }
      i = res.end;
    } else {
      i = res.end;
    }
    if (seenBlankAfterBlock) { loose = true; }
    seenBlankAfterBlock = false;
    seenBlock = true;
    first = false;
    out += res.html;
  }
  return { html: out, loose };
}

export function parse(src) {
  src = src.replace(/\r\n?/g, '\n');
  const endsWithNL = src.endsWith('\n');
  const rawLines = src.split('\n');
  if (endsWithNL) rawLines.pop();
  const lines = rawLines.map((s, idx) => ({ s, b: 0, nl: idx < rawLines.length - 1 || endsWithNL }));
  const defs = new Map();
  inAnchor = false;
  // Two passes: first collect every link reference definition in the
  // document (a definition may sit after the paragraph that uses it),
  // then render with the complete map.
  parseBlocks(lines, defs, false, false, true, true, false);
  return parseBlocks(lines, defs, false, false, false, true, false).html;
}
