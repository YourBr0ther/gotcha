/**
 * A small Molang interpreter. It covers the subset Cobblemon's animation
 * files use for keyframe values: arithmetic, comparisons, the ternary,
 * `math.*` helpers, and the time queries `q.anim_time` and `q.life_time`.
 *
 * Anything else throws `MolangUnsupported`. The animation loader catches it,
 * falls back to the static value, and logs once per expression, so an exotic
 * expression degrades one channel rather than the whole clip.
 *
 * Molang trig takes and returns degrees.
 */

export class MolangUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MolangUnsupported";
  }
}

export interface MolangContext {
  /** Seconds since the clip started. */
  animTime: number;
  /** Seconds since the entity appeared. */
  lifeTime: number;
  /** `variable.*` / `temp.*` lookups, keyed without the prefix. */
  vars?: Record<string, number>;
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "-" | "!"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "ternary"; test: Node; then: Node; else: Node }
  | { kind: "call"; name: string; args: Node[] };

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "end" };

const TWO_CHAR_OPS = new Set(["<=", ">=", "==", "!=", "&&", "||", "??"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "(", ")", ",", "?", ":", "<", ">", "!", ";"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      // Molang allows a trailing f, as in 1.0f.
      if (src[j] === "f" || src[j] === "F") j++;
      out.push({ type: "num", value: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++;
      out.push({ type: "ident", value: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      out.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      out.push({ type: "op", value: c });
      i++;
      continue;
    }
    throw new MolangUnsupported(`Unexpected character '${c}' in "${src}"`);
  }
  out.push({ type: "end" });
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly src: string) {}

  parse(): Node {
    // A trailing statement form: "return <expr>;" or "<expr>;".
    if (this.peekIdent("return")) this.pos++;
    const node = this.ternary();
    if (this.peekOp(";")) this.pos++;
    if (this.tokens[this.pos].type !== "end") {
      throw new MolangUnsupported(`Unexpected trailing input in "${this.src}"`);
    }
    return node;
  }

  private peekOp(op: string): boolean {
    const t = this.tokens[this.pos];
    return t.type === "op" && t.value === op;
  }

  private peekIdent(name: string): boolean {
    const t = this.tokens[this.pos];
    return t.type === "ident" && t.value === name;
  }

  private takeOp(op: string): void {
    if (!this.peekOp(op)) throw new MolangUnsupported(`Expected '${op}' in "${this.src}"`);
    this.pos++;
  }

  private ternary(): Node {
    const test = this.binary(0);
    if (this.peekOp("?")) {
      this.pos++;
      const then = this.ternary();
      this.takeOp(":");
      const otherwise = this.ternary();
      return { kind: "ternary", test, then, else: otherwise };
    }
    if (this.peekOp("??")) {
      this.pos++;
      const fallback = this.ternary();
      return { kind: "binary", op: "??", left: test, right: fallback };
    }
    return test;
  }

  private static PRECEDENCE: Record<string, number> = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    ">": 4,
    "<=": 4,
    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
  };

  private binary(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.tokens[this.pos];
      if (t.type !== "op") break;
      const prec = Parser.PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      const right = this.binary(prec + 1);
      left = { kind: "binary", op: t.value, left, right };
    }
    return left;
  }

  private unary(): Node {
    if (this.peekOp("-")) {
      this.pos++;
      return { kind: "unary", op: "-", arg: this.unary() };
    }
    if (this.peekOp("!")) {
      this.pos++;
      return { kind: "unary", op: "!", arg: this.unary() };
    }
    if (this.peekOp("+")) {
      this.pos++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.tokens[this.pos];
    if (t.type === "num") {
      this.pos++;
      return { kind: "num", value: t.value };
    }
    if (t.type === "op" && t.value === "(") {
      this.pos++;
      const inner = this.ternary();
      this.takeOp(")");
      return inner;
    }
    if (t.type === "ident") {
      this.pos++;
      if (this.peekOp("(")) {
        this.pos++;
        const args: Node[] = [];
        if (!this.peekOp(")")) {
          for (;;) {
            args.push(this.ternary());
            if (this.peekOp(",")) {
              this.pos++;
              continue;
            }
            break;
          }
        }
        this.takeOp(")");
        return { kind: "call", name: t.value, args };
      }
      return { kind: "var", name: t.value };
    }
    throw new MolangUnsupported(`Unexpected token in "${this.src}"`);
  }
}

const parseCache = new Map<string, Node>();

export function parseMolang(src: string): Node {
  const cached = parseCache.get(src);
  if (cached) return cached;
  const node = new Parser(tokenize(src), src).parse();
  parseCache.set(src, node);
  return node;
}

const DEG = Math.PI / 180;

function truthy(v: number): boolean {
  return v !== 0;
}

function readVar(name: string, ctx: MolangContext): number {
  switch (name) {
    case "q.anim_time":
    case "query.anim_time":
      return ctx.animTime;
    case "q.life_time":
    case "query.life_time":
      return ctx.lifeTime;
    case "math.pi":
      return Math.PI;
    case "true":
      return 1;
    case "false":
      return 0;
  }
  // Ride-only queries (q.r.yaw_change and friends) read 0 outside a mount.
  if (name.startsWith("q.r.") || name.startsWith("query.r.") || name === "q.riding_yaw_change") return 0;
  const dot = name.indexOf(".");
  if (dot > 0) {
    const prefix = name.slice(0, dot);
    const key = name.slice(dot + 1);
    if (prefix === "variable" || prefix === "v" || prefix === "temp" || prefix === "t") {
      const v = ctx.vars?.[key];
      if (v !== undefined) return v;
      throw new MolangUnsupported(`Unknown variable ${name}`);
    }
  }
  throw new MolangUnsupported(`Unknown query ${name}`);
}

function call(name: string, args: number[], src: string): number {
  const need = (n: number) => {
    if (args.length < n) throw new MolangUnsupported(`${name} needs ${n} args in "${src}"`);
  };
  if (name.startsWith("q.r.") || name.startsWith("query.r.") || name === "q.riding_yaw_change") return 0;
  switch (name) {
    case "math.random":
      // Sampled clips are baked once, so a random value would freeze anyway;
      // the midpoint keeps the pose where the author centred it.
      need(2);
      return (args[0] + args[1]) / 2;
    case "math.sin":
      need(1);
      return Math.sin(args[0] * DEG);
    case "math.cos":
      need(1);
      return Math.cos(args[0] * DEG);
    case "math.abs":
      need(1);
      return Math.abs(args[0]);
    case "math.clamp":
      need(3);
      return Math.min(Math.max(args[0], args[1]), args[2]);
    case "math.lerp":
      need(3);
      return args[0] + (args[1] - args[0]) * args[2];
    case "math.min":
      need(2);
      return Math.min(args[0], args[1]);
    case "math.max":
      need(2);
      return Math.max(args[0], args[1]);
    case "math.floor":
      need(1);
      return Math.floor(args[0]);
    case "math.ceil":
      need(1);
      return Math.ceil(args[0]);
    case "math.round":
      need(1);
      return Math.round(args[0]);
    case "math.trunc":
      need(1);
      return Math.trunc(args[0]);
    case "math.sqrt":
      need(1);
      return Math.sqrt(args[0]);
    case "math.pow":
      need(2);
      return Math.pow(args[0], args[1]);
    case "math.mod":
      need(2);
      return args[0] % args[1];
    case "math.exp":
      need(1);
      return Math.exp(args[0]);
    case "math.ln":
      need(1);
      return Math.log(args[0]);
  }
  throw new MolangUnsupported(`Unknown function ${name} in "${src}"`);
}

function evalNode(node: Node, ctx: MolangContext, src: string): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var":
      return readVar(node.name, ctx);
    case "unary": {
      const v = evalNode(node.arg, ctx, src);
      return node.op === "-" ? -v : truthy(v) ? 0 : 1;
    }
    case "ternary":
      return truthy(evalNode(node.test, ctx, src))
        ? evalNode(node.then, ctx, src)
        : evalNode(node.else, ctx, src);
    case "call":
      return call(
        node.name,
        node.args.map((a) => evalNode(a, ctx, src)),
        src,
      );
    case "binary": {
      const l = evalNode(node.left, ctx, src);
      // Short circuit the logical operators before evaluating the right side.
      if (node.op === "&&") return truthy(l) && truthy(evalNode(node.right, ctx, src)) ? 1 : 0;
      if (node.op === "||") return truthy(l) || truthy(evalNode(node.right, ctx, src)) ? 1 : 0;
      if (node.op === "??") return l;
      const r = evalNode(node.right, ctx, src);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
        case "<":
          return l < r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "==":
          return l === r ? 1 : 0;
        case "!=":
          return l !== r ? 1 : 0;
      }
      throw new MolangUnsupported(`Unknown operator ${node.op}`);
    }
  }
}

/** Evaluate a Molang expression. Throws `MolangUnsupported` outside the subset. */
export function evaluateMolang(src: string, ctx: MolangContext): number {
  return evalNode(parseMolang(src), ctx, src);
}

/** True if the expression references anything that changes over time. */
export function isTimeDependent(src: string): boolean {
  const stack: Node[] = [parseMolang(src)];
  while (stack.length) {
    const n = stack.pop()!;
    switch (n.kind) {
      case "var":
        if (n.name.startsWith("q.r.") || n.name.startsWith("query.r.")) break;
        if (n.name !== "math.pi" && n.name !== "true" && n.name !== "false") return true;
        break;
      case "unary":
        stack.push(n.arg);
        break;
      case "binary":
        stack.push(n.left, n.right);
        break;
      case "ternary":
        stack.push(n.test, n.then, n.else);
        break;
      case "call":
        stack.push(...n.args);
        break;
    }
  }
  return false;
}

const warned = new Set<string>();

/**
 * Log an unsupported expression once. Returns true the first time so callers
 * can attach extra detail to that one message.
 */
export function warnOnce(key: string, message: string): boolean {
  if (warned.has(key)) return false;
  warned.add(key);
  console.warn(`[molang] ${message}`);
  return true;
}

/** Test hook. */
export function resetMolangWarnings(): void {
  warned.clear();
}
