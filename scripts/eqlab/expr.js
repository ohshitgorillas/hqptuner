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

const NUM_RE = /^\d+(\.\d+)?([eE][-+]?\d+)?/;
const ID_RE = /^[A-Za-z_][A-Za-z_0-9]*/;
const PUNCT = "+-*/(),";

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i += 1;
    } else if (PUNCT.includes(ch)) {
      out.push({ t: ch });
      i += 1;
    } else {
      const rest = src.slice(i);
      const num = NUM_RE.exec(rest);
      const id = num ? null : ID_RE.exec(rest);
      if (!num && !id) throw new Error(`expr: unexpected character "${ch}" at position ${i} of "${src}"`);
      const text = (num || id)[0];
      out.push(num ? { t: "num", v: Number(text) } : { t: "id", v: text });
      i += text.length;
    }
  }
  return out;
}

// One parser instance per parse; `pos` is the only mutable state.
function makeParser(tokens, src) {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (t) => {
    if (!peek() || peek().t !== t) throw new Error(`expr: expected "${t}" in "${src}"`);
    pos += 1;
    return tokens[pos - 1];
  };
  return { peek, take, at: () => pos, src };
}

function parseArgs(p) {
  const args = [];
  p.take("(");
  if (p.peek() && p.peek().t !== ")") {
    args.push(parseExpr(p));
    while (p.peek() && p.peek().t === ",") {
      p.take(",");
      args.push(parseExpr(p));
    }
  }
  p.take(")");
  return args;
}

function parsePrimary(p) {
  const tok = p.peek();
  if (!tok) throw new Error(`expr: unexpected end of "${p.src}"`);
  if (tok.t === "num") {
    p.take("num");
    return { n: "num", v: tok.v };
  }
  if (tok.t === "id") {
    p.take("id");
    if (p.peek() && p.peek().t === "(") return { n: "call", name: tok.v, args: parseArgs(p) };
    return { n: "var", name: tok.v };
  }
  p.take("(");
  const inner = parseExpr(p);
  p.take(")");
  return inner;
}

function parseFactor(p) {
  if (p.peek() && p.peek().t === "-") {
    p.take("-");
    return { n: "neg", e: parseFactor(p) };
  }
  return parsePrimary(p);
}

function parseTerm(p) {
  let left = parseFactor(p);
  while (p.peek() && (p.peek().t === "*" || p.peek().t === "/")) {
    const op = p.take(p.peek().t).t;
    left = { n: "bin", op, l: left, r: parseFactor(p) };
  }
  return left;
}

function parseExpr(p) {
  let left = parseTerm(p);
  while (p.peek() && (p.peek().t === "+" || p.peek().t === "-")) {
    const op = p.take(p.peek().t).t;
    left = { n: "bin", op, l: left, r: parseTerm(p) };
  }
  return left;
}

/** Parse an expression string into an AST. Throws on anything the grammar rejects. */
export function parse(src) {
  if (typeof src !== "string" || !src.trim()) throw new Error("expr: expression must be a non-empty string");
  const p = makeParser(tokenize(src), src);
  const ast = parseExpr(p);
  if (p.peek()) throw new Error(`expr: trailing input in "${src}"`);
  return ast;
}

const BIN = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
};

function evalCall(node, env) {
  const fn = (env.funcs || {})[node.name];
  if (!fn) throw new Error(`expr: unknown function "${node.name}"`);
  return fn(...node.args.map((a) => evaluate(a, env)));
}

function evalVar(node, env) {
  const vars = env.vars || {};
  if (!(node.name in vars)) throw new Error(`expr: unknown name "${node.name}"`);
  return Number(vars[node.name]);
}

/** Evaluate an AST against {funcs, vars}. */
export function evaluate(node, env) {
  if (node.n === "num") return node.v;
  if (node.n === "neg") return -evaluate(node.e, env);
  if (node.n === "var") return evalVar(node, env);
  if (node.n === "call") return evalCall(node, env);
  return BIN[node.op](evaluate(node.l, env), evaluate(node.r, env));
}

/** parse + evaluate in one step (single-shot expressions). */
export function evalExpr(src, env) {
  return evaluate(parse(src), env);
}
