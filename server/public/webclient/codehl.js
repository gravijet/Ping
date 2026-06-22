/* codehl.js — a tiny, dependency-free syntax highlighter for code-snippet cards
   (0.35.0). It returns an HTML string in which every token's text is escaped
   before it's wrapped, so highlighting can never inject markup — the worst a
   crafted snippet can do is mis-colour itself. One generic scanner covers most
   curly-brace / hash-comment languages; HTML/XML gets a small dedicated pass.

   This is intentionally not a full parser. It recognises comments, strings,
   numbers, keywords and a couple of structural hints — enough to make a pasted
   function readable without pulling a 200 KB library into a build-less app. */

const KW = {
  js: 'await async break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined',
  ts: 'await async break case catch class const continue declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let namespace new of private protected public readonly return set static super switch this throw try type typeof var void while yield as is true false null undefined number string boolean any unknown never',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self print',
  sql: 'select from where insert update delete into values set create table alter drop index view join inner left right outer on group by order having limit offset as distinct count sum avg min max and or not null is in like between union all primary key foreign references default',
  bash: 'if then else elif fi for while do done case esac function in return local export echo cd ls then exit set source read test',
  rust: 'as break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self struct super trait type unsafe use where while async await true false',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  css: '',
  json: 'true false null',
};
// Family aliases so common names resolve to one of the keyword sets above.
const ALIAS = {
  javascript: 'js', jsx: 'js', mjs: 'js', node: 'js',
  typescript: 'ts', tsx: 'ts',
  python: 'py', py3: 'py',
  shell: 'bash', sh: 'bash', zsh: 'bash',
  golang: 'go',
  rs: 'rust',
  scss: 'css', less: 'css',
  yml: 'bash', yaml: 'bash',
  c: 'js', 'c++': 'js', cpp: 'js', java: 'js', kotlin: 'js', kt: 'js',
  php: 'js', ruby: 'py', rb: 'py', swift: 'js', dart: 'js',
};

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`;

/** Resolve a user-supplied language label to one of our scanner profiles. */
export function resolveLang(language) {
  const k = String(language || '').toLowerCase().trim();
  return ALIAS[k] || (KW[k] ? k : '');
}

// Generic scanner for brace/hash-comment languages. Walks left-to-right and
// always consumes at least one character, so it can't loop forever.
function scanGeneric(code, lang) {
  const kws = new Set((KW[lang] || KW.js).split(' '));
  const hashComment = lang === 'py' || lang === 'bash';
  const dashComment = lang === 'sql';
  let out = '';
  let i = 0;
  const n = code.length;
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    const c = code[i];
    const two = code.slice(i, i + 2);
    // Comments.
    if (two === '//' || (hashComment && c === '#') || (dashComment && two === '--')) {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      out += span('com', code.slice(i, j));
      i = j;
      continue;
    }
    if (two === '/*') {
      let j = code.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      out += span('com', code.slice(i, j));
      i = j;
      continue;
    }
    // Strings (single, double, backtick) — no escaping subtleties beyond \\.
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && code[j] !== c) { if (code[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      out += span('str', code.slice(i, j));
      i = j;
      continue;
    }
    // Numbers (incl. hex / decimals).
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9a-fxA-FX._]/.test(code[j])) j++;
      out += span('num', code.slice(i, j));
      i = j;
      continue;
    }
    // Identifiers / keywords.
    if (isId(c)) {
      let j = i;
      while (j < n && isId(code[j])) j++;
      const word = code.slice(i, j);
      if (kws.has(word) || (lang === 'sql' && kws.has(word.toLowerCase()))) out += span('kw', word);
      else if (code[j] === '(') out += span('fn', word);
      else out += esc(word);
      i = j;
      continue;
    }
    // Structural punctuation gets a muted colour; everything else passes through.
    if ('{}[]()=>+-*/%<>&|!?:;,.'.includes(c)) out += span('punct', c);
    else out += esc(c);
    i++;
  }
  return out;
}

// Dedicated HTML/XML pass: comments, tags (name + attributes + quoted values).
function scanHtml(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code.slice(i, i + 4) === '<!--') {
      let j = code.indexOf('-->', i + 4);
      j = j === -1 ? n : j + 3;
      out += span('com', code.slice(i, j));
      i = j;
      continue;
    }
    if (code[i] === '<') {
      let j = code.indexOf('>', i);
      j = j === -1 ? n : j + 1;
      const tag = code.slice(i, j);
      // name in kw colour, "…"/'…' attribute values in str colour, rest plain.
      out += tag.replace(/[&<>"']/g, (ch) => esc(ch))
        .replace(/^(&lt;\/?)([a-zA-Z0-9-]+)/, (_, a, name) => a + `<span class="hl-kw">${name}</span>`)
        .replace(/(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g, (s) => `<span class="hl-str">${s}</span>`);
      i = j;
      continue;
    }
    let j = code.indexOf('<', i);
    j = j === -1 ? n : j;
    out += esc(code.slice(i, j));
    i = j;
  }
  return out;
}

/** Highlight [code] for [language]; returns escaped HTML (safe to set as html). */
export function highlight(code, language) {
  const src = String(code == null ? '' : code);
  const lang = resolveLang(language);
  try {
    if (lang === 'html' || lang === 'xml' || language === 'html' || language === 'xml') {
      return scanHtml(src);
    }
    return scanGeneric(src, lang);
  } catch {
    // Highlighting must never break rendering — fall back to plain escaped text.
    return esc(src);
  }
}
