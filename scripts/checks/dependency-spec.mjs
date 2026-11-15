// AGENTS.md §9.4 / §4: adding or changing a dependency requires an ADR.
//
// Shared by `.claude/hooks/check-dependency-adr.mjs` (which sees the text an
// agent is about to write) and `.githooks/pre-commit.mjs` (which sees the
// staged diff). The regex below IS the check — a second copy of it could be
// weakened on one path while the other still passed, and nothing would report
// the difference. That is why it lives here and not in either caller.

/**
 * A JSON line shaped like `"<name>": "<version-or-source-spec>"`.
 *
 * The alternation is what keeps a script entry out: `"db:seed": "pnpm ..."`
 * does not start with a version token, so it is not a dependency. Note that
 * `git+` requires the plus — a value beginning `git config ...` is a script,
 * not a git dependency, and must not match.
 */
export const SPEC =
  /"[^"]+"\s*:\s*"(?:\^|~|>=|<=|>|<|\d|\*|workspace:|npm:|file:|link:|git\+|https?:|github:)/;

/** Every line of `text` that looks like a dependency specifier. */
export function specLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => SPEC.test(l));
}

/**
 * Specifier lines present in `after` but not in `before`.
 *
 * Set-based rather than positional, so reordering a manifest reports nothing.
 */
export function addedSpecLines(before, after) {
  const seen = new Set(specLines(before));
  return specLines(after).filter((l) => !seen.has(l));
}

// ---------------------------------------------------------------------------
// Python manifests (ADR 0135, plan E1.1 PR 1).
//
// Section-aware on purpose. A bare regex over quoted strings would also match
// ruff's rule codes (`select = ["E", "F"]`) and every other string in the file,
// so the scanner tracks the current TOML table and only collects entries from
// the places a dependency can be declared. It is a line scanner, not a TOML
// parser: it handles the shapes `uv` writes (quoted strings, multi-line arrays,
// inline tables on one line), which is what this gate needs.

/** Tables whose every non-blank, non-comment line is a dependency fact. */
const PY_RAW_TABLES = new Set(['tool.uv.sources', 'tool.uv.index']);

/** `table → keys` whose array values are dependency specifiers. `*` = any key. */
const PY_ARRAY_KEYS = {
  project: new Set(['dependencies']),
  'project.optional-dependencies': '*',
  'dependency-groups': '*',
  'build-system': new Set(['requires']),
  'tool.uv': new Set(['dev-dependencies', 'constraint-dependencies', 'override-dependencies']),
};

/** Strip a `#` comment that sits outside any string. */
function stripTomlComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

/** Quoted strings in a line, and its `[` minus `]` count outside strings. */
function scanTomlLine(line) {
  const strings = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < line.length) {
        cur += line[++i];
      } else if (c === quote) {
        strings.push(cur);
        quote = '';
        cur = '';
      } else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return { strings, depth };
}

function arrayKeyIsGated(table, key) {
  const keys = PY_ARRAY_KEYS[table];
  return keys === '*' || (keys instanceof Set && keys.has(key));
}

/** Every dependency entry declared in a `pyproject.toml`, normalised. */
export function pyDependencyEntries(text) {
  const out = [];
  let table = '';
  let arrayKey = ''; // non-empty while inside a gated multi-line array
  let depth = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;

    if (arrayKey) {
      const { strings, depth: d } = scanTomlLine(line);
      for (const s of strings) out.push(`[${table}] ${arrayKey}: "${s}"`);
      depth += d;
      if (depth <= 0) arrayKey = '';
      continue;
    }

    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = header[1].replace(/\s+/g, '');
      continue;
    }

    if (PY_RAW_TABLES.has(table)) {
      out.push(`[${table}] ${line.replace(/\s+/g, ' ')}`);
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].replace(/^"|"$/g, '');
    if (!arrayKeyIsGated(table, key)) continue;
    const { strings, depth: d } = scanTomlLine(kv[2]);
    for (const s of strings) out.push(`[${table}] ${key}: "${s}"`);
    if (d > 0) {
      arrayKey = key;
      depth = d;
    }
  }
  return out;
}

/** Python dependency entries present in `after` but not in `before` (set-based). */
export function addedPyDependencyEntries(before, after) {
  const seen = new Set(pyDependencyEntries(before));
  return pyDependencyEntries(after).filter((e) => !seen.has(e));
}

/** Package names in a `uv.lock`: the `name = "…"` under each `[[package]]`. */
export function uvLockPackageNames(text) {
  const out = [];
  let inPackage = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[\[package\]\]$/.test(line)) {
      inPackage = true;
      continue;
    }
    if (/^\[/.test(line)) {
      inPackage = false;
      continue;
    }
    const m = inPackage && /^name\s*=\s*"([^"]+)"/.exec(line);
    if (m) {
      out.push(m[1]);
      inPackage = false;
    }
  }
  return out;
}

/** Package names locked in `after` but not in `before`. A version bump adds none. */
export function addedUvLockPackageNames(before, after) {
  const seen = new Set(uvLockPackageNames(before));
  return uvLockPackageNames(after).filter((n) => !seen.has(n));
}
