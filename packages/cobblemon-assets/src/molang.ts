// Scanning helpers for Molang strings. This is not an interpreter: it finds
// the query variables, math functions and operators an expression uses so
// the extractor can list animation references and the survey can report what
// the renderer's interpreter has to cover.

export type MolangNamespace = "query" | "math" | "variable" | "temp" | "context";

export interface MolangRef {
  namespace: MolangNamespace;
  /** Canonical form, e.g. `q.anim_time` or `math.sin`. */
  canonical: string;
  /** The spelling in the source, e.g. `query.anim_time`. */
  raw: string;
  /** True when the reference is followed by `(`. */
  call: boolean;
}

const NAMESPACES: Record<string, MolangNamespace> = {
  q: "query",
  query: "query",
  math: "math",
  v: "variable",
  variable: "variable",
  t: "temp",
  temp: "temp",
  c: "context",
  context: "context",
};

const SHORT: Record<MolangNamespace, string> = {
  query: "q",
  math: "math",
  variable: "v",
  temp: "t",
  context: "c",
};

// Names may be dotted, as in `q.r.yaw_change`, Cobblemon's riding queries.
// Case-insensitive because one animation writes `Math.cos`; Molang itself ignores case.
const REF_PATTERN = /(?<![A-Za-z0-9_.:/])(q|query|math|v|variable|t|temp|c|context)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(\s*\()?/gi;

export function scanMolang(expr: string): MolangRef[] {
  const refs: MolangRef[] = [];
  for (const match of expr.matchAll(REF_PATTERN)) {
    const namespace = NAMESPACES[match[1].toLowerCase()];
    const name = match[2].toLowerCase();
    refs.push({
      namespace,
      canonical: `${SHORT[namespace]}.${name}`,
      raw: `${match[1]}.${match[2]}`,
      call: match[3] !== undefined,
    });
  }
  return refs;
}

export interface OperatorPattern {
  name: string;
  pattern: RegExp;
}

/** Syntax beyond identifiers that an interpreter would need. Order matters for readability only. */
export const OPERATOR_PATTERNS: OperatorPattern[] = [
  { name: "ternary ?:", pattern: /\?[^?]*:/ },
  { name: "conditional ? { } with no else", pattern: /\?\s*\{/ },
  { name: "null coalesce ??", pattern: /\?\?/ },
  { name: "logical and &&", pattern: /&&/ },
  { name: "logical or ||", pattern: /\|\|/ },
  { name: "logical not !", pattern: /!(?!=)/ },
  { name: "equality == !=", pattern: /==|!=/ },
  { name: "comparison < > <= >=", pattern: /<=|>=|(?<![<>=!])[<>](?![=<>])/ },
  { name: "add/subtract + -", pattern: /[^-+\d.eE(,'[\s][+]|\S\s*-\s*[\w(]/ },
  { name: "multiply/divide * /", pattern: /[*/]/ },
  { name: "negative literal / unary minus", pattern: /(^|[(,\s*/+=<>?:&|!-])-\s*[\d.(qmvtcQ]/ },
  { name: "parentheses", pattern: /[()]/ },
  { name: "string literal '...'", pattern: /'[^']*'/ },
  { name: "assignment =", pattern: /(?<![=!<>])=(?!=)/ },
  { name: "statements ;", pattern: /;/ },
  { name: "return", pattern: /\breturn\b/ },
  { name: "loop()", pattern: /\bloop\s*\(/ },
  { name: "for_each()", pattern: /\bfor_each\s*\(/ },
  { name: "break / continue", pattern: /\b(break|continue)\b/ },
  { name: "braces {}", pattern: /[{}]/ },
  { name: "array index []", pattern: /\w\[[^\]]*\]/ },
  { name: "this", pattern: /\bthis\b/ },
  { name: "arrow ->", pattern: /->/ },
];

export function scanOperators(expr: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of OPERATOR_PATTERNS) {
    if (pattern.test(expr)) found.push(name);
  }
  return found;
}

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

/** True for strings that are not just a number, so they would need evaluating. */
export function isMolangExpression(value: string): boolean {
  return !NUMERIC.test(value) && value.trim().length > 0;
}

export interface AnimationReference {
  /** Animation group, the first argument of `q.bedrock('eevee', ...)`. */
  group: string;
  /** Clip names given as string literals; empty when chosen by an expression. */
  clips: string[];
  /** The full call text. */
  raw: string;
  /** Which `q.bedrock*` function was used. */
  fn: string;
}

const BEDROCK_CALL = /q\.(bedrock(?:_stateful|_quirk|_primary|_primary_quirk|_primary_stateful)?)\s*\(/g;

/** Find `q.bedrock*('group', 'clip', ...)` calls in a poser expression. */
export function findAnimationReferences(expr: string): AnimationReference[] {
  const refs: AnimationReference[] = [];
  for (const match of expr.matchAll(BEDROCK_CALL)) {
    const start = match.index + match[0].length;
    const end = matchParen(expr, start);
    const args = splitArgs(expr.slice(start, end));
    if (args.length === 0) continue;
    const group = unquote(args[0]);
    if (group === null) continue;
    // Only the second argument names the clip. Later arguments are timing
    // numbers, excluded labels such as 'look' in q.bedrock_primary, or curves.
    const clips: string[] = [];
    const clipArg = args[1];
    if (clipArg !== undefined) {
      const literal = unquote(clipArg);
      if (literal !== null) clips.push(literal);
      else {
        // q.array('a', 'b') or a ternary: take every quoted name.
        for (const quoted of clipArg.matchAll(/'([^']+)'/g)) clips.push(quoted[1]);
      }
    }
    refs.push({ group, clips: unique(clips), raw: expr.slice(match.index, end + 1), fn: match[1] });
  }
  return refs;
}

function matchParen(text: string, start: number): number {
  let depth = 1;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function unquote(arg: string): string | null {
  const match = /^'([^']*)'$/.exec(arg.trim());
  return match ? match[1] : null;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Every string value in a JSON tree with the key path that led to it. */
export function walkStrings(value: unknown, visit: (text: string, path: string[]) => void, path: string[] = []): void {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, i) => walkStrings(item, visit, [...path, String(i)]));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walkStrings(child, visit, [...path, key]);
  }
}
