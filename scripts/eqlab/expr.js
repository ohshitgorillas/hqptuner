// Arithmetic expression evaluator for eqlab metric and objective expressions.
//
// Deliberately NOT `eval` / `new Function`: job JSON arrives from a model, and
// the tool is read-only by construction — an expression must not be able to
// reach the filesystem, the network, or the daemon. This is a closed grammar:
//
//   expr   := term (("+" | "-") term)*
//   term   := factor (("*" | "/") factor)*
//   factor := "-" factor | primary
//   primary:= number | ident "(" [expr ("," expr)*] ")" | ident | "(" expr ")"
//
// Identifiers resolve against `env.vars` (metric names in an objective, earlier
// metrics in a metric expression); calls against `env.funcs`. Anything else is
// an error, never a silent zero.

/**
 * The punctuation the grammar admits, as a type. Kept in step with `PUNCT`
 * below by the cast in `tokenize` — that cast is the one place the two spellings
 * have to agree.
 *
 * @typedef {"+" | "-" | "*" | "/" | "(" | ")" | ","} Punct
 */

/**
 * A lexed token. Discriminated on `t`: a punctuation token carries no value,
 * and the two that do disagree on its type, which is why this is a union rather
 * than one shape with an optional `v`.
 *
 * @typedef {{ t: "num", v: number } | { t: "id", v: string } | { t: Punct }} Token
 */

/**
 * One AST node. `Node` is recursive through `neg`, `bin` and `call`, so every
 * parse function below needs an explicit `@returns` — without one tsc reports
 * the return type as implicitly circular.
 *
 * @typedef {{ n: "num", v: number }} NumNode
 * @typedef {{ n: "var", name: string }} VarNode
 * @typedef {{ n: "call", name: string, args: Node[] }} CallNode
 * @typedef {{ n: "neg", e: Node }} NegNode
 * @typedef {{ n: "bin", op: "+" | "-" | "*" | "/", l: Node, r: Node }} BinNode
 * @typedef {NumNode | VarNode | CallNode | NegNode | BinNode} Node
 */

/**
 * What an expression resolves names against. Both halves are optional because
 * the callers that supply only one read the other through `|| {}`.
 *
 * `vars` admits strings as well as numbers: a metric value arrives from JSON and
 * `evalVar` puts it through `Number()` rather than assuming it already is one.
 *
 * @typedef {{
 *   funcs?: Record<string, (...args: number[]) => number>,
 *   vars?: Record<string, number | string>,
 * }} Env
 */

const NUM_RE = /^\d+(\.\d+)?([eE][-+]?\d+)?/;
const ID_RE = /^[A-Za-z_][A-Za-z_0-9]*/;
const PUNCT = "+-*/(),";

/**
 * @param {string} src
 * @returns {Token[]}
 */
function tokenize(src) {
  /** @type {Token[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i += 1;
    } else if (PUNCT.includes(ch)) {
      // `PUNCT.includes` is the check that makes this cast sound; tsc cannot
      // carry that from a string search back into the literal union.
      out.push({ t: /** @type {Punct} */ (ch) });
      i += 1;
    } else {
      const rest = src.slice(i);
      const num = NUM_RE.exec(rest);
      const id = num ? null : ID_RE.exec(rest);
      const match = num || id;
      if (!match) throw new Error(`expr: unexpected character "${ch}" at position ${i} of "${src}"`);
      const text = match[0];
      out.push(num ? { t: "num", v: Number(text) } : { t: "id", v: text });
      i += text.length;
    }
  }
  return out;
}

/**
 * One parser instance per parse; `pos` is the only mutable state.
 *
 * @typedef {{ peek: () => Token | undefined, take: (t: Token["t"]) => Token, at: () => number, src: string }} Parser
 */

/**
 * @param {Token[]} tokens
 * @param {string} src
 * @returns {Parser}
 */
function makeParser(tokens, src) {
  let pos = 0;
  const peek = () => tokens[pos];
  /** @type {Parser["take"]} */
  const take = (t) => {
    const tok = peek();
    if (!tok || tok.t !== t) throw new Error(`expr: expected "${t}" in "${src}"`);
    pos += 1;
    return tokens[pos - 1];
  };
  return { peek, take, at: () => pos, src };
}

/**
 * @param {Parser} p
 * @returns {Node[]}
 */
function parseArgs(p) {
  /** @type {Node[]} */
  const args = [];
  p.take("(");
  const first = p.peek();
  if (first && first.t !== ")") {
    args.push(parseExpr(p));
    for (let tok = p.peek(); tok && tok.t === ","; tok = p.peek()) {
      p.take(",");
      args.push(parseExpr(p));
    }
  }
  p.take(")");
  return args;
}

/**
 * @param {Parser} p
 * @returns {Node}
 */
function parsePrimary(p) {
  const tok = p.peek();
  if (!tok) throw new Error(`expr: unexpected end of "${p.src}"`);
  if (tok.t === "num") {
    p.take("num");
    return { n: "num", v: tok.v };
  }
  if (tok.t === "id") {
    p.take("id");
    const next = p.peek();
    if (next && next.t === "(") return { n: "call", name: tok.v, args: parseArgs(p) };
    return { n: "var", name: tok.v };
  }
  p.take("(");
  const inner = parseExpr(p);
  p.take(")");
  return inner;
}

/**
 * @param {Parser} p
 * @returns {Node}
 */
function parseFactor(p) {
  const tok = p.peek();
  if (tok && tok.t === "-") {
    p.take("-");
    return { n: "neg", e: parseFactor(p) };
  }
  return parsePrimary(p);
}

/**
 * @param {Parser} p
 * @returns {Node}
 */
function parseTerm(p) {
  let left = parseFactor(p);
  for (let tok = p.peek(); tok && (tok.t === "*" || tok.t === "/"); tok = p.peek()) {
    const op = tok.t;
    p.take(op);
    left = { n: "bin", op, l: left, r: parseFactor(p) };
  }
  return left;
}

/**
 * @param {Parser} p
 * @returns {Node}
 */
function parseExpr(p) {
  let left = parseTerm(p);
  for (let tok = p.peek(); tok && (tok.t === "+" || tok.t === "-"); tok = p.peek()) {
    const op = tok.t;
    p.take(op);
    left = { n: "bin", op, l: left, r: parseTerm(p) };
  }
  return left;
}

/**
 * Parse an expression string into an AST. Throws on anything the grammar rejects.
 *
 * `src` is `unknown` rather than `string` on purpose: expressions arrive from
 * job JSON, so the type guard below is a real runtime check on untyped input,
 * not a redundant assertion about a parameter tsc already proved.
 *
 * @param {unknown} src
 * @returns {Node}
 */
export function parse(src) {
  if (typeof src !== "string" || !src.trim()) throw new Error("expr: expression must be a non-empty string");
  const p = makeParser(tokenize(src), src);
  const ast = parseExpr(p);
  if (p.peek()) throw new Error(`expr: trailing input in "${src}"`);
  return ast;
}

/** @type {Record<BinNode["op"], (a: number, b: number) => number>} */
const BIN = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
};

/**
 * @param {CallNode} node
 * @param {Env} env
 * @returns {number}
 */
function evalCall(node, env) {
  const fn = (env.funcs || {})[node.name];
  if (!fn) throw new Error(`expr: unknown function "${node.name}"`);
  return fn(...node.args.map((a) => evaluate(a, env)));
}

/**
 * @param {VarNode} node
 * @param {Env} env
 * @returns {number}
 */
function evalVar(node, env) {
  const vars = env.vars || {};
  if (!(node.name in vars)) throw new Error(`expr: unknown name "${node.name}"`);
  return Number(vars[node.name]);
}

/**
 * Evaluate an AST against {funcs, vars}.
 *
 * @param {Node} node
 * @param {Env} env
 * @returns {number}
 */
export function evaluate(node, env) {
  if (node.n === "num") return node.v;
  if (node.n === "neg") return -evaluate(node.e, env);
  if (node.n === "var") return evalVar(node, env);
  if (node.n === "call") return evalCall(node, env);
  return BIN[node.op](evaluate(node.l, env), evaluate(node.r, env));
}

/**
 * parse + evaluate in one step (single-shot expressions).
 *
 * @param {unknown} src
 * @param {Env} env
 * @returns {number}
 */
export function evalExpr(src, env) {
  return evaluate(parse(src), env);
}
