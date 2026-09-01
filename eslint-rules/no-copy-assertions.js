// Gate: a test never asserts a string it did not put on the wire itself
// (docs/testing.md rule 9). The JS peer of scripts/gates/check_no_copy_assertions.py,
// with the same semantics:
//
//   a literal of two or more words the assertion compares against is copy unless
//   the tests seeded it. Copy is owner-owned data, reworded at will; a test
//   pinning it goes red on a rewording and green on a broken behavior.
//
// Seeded means any of:
//   - the literal appears outside an assertion in this file, or in a module this
//     file imports from under the suite's `tests/` directory (the harness);
//   - the assertion line itself hands it to a plain function
//     (`describe({ tooltip: "Idle prose." })` is input, not a search);
//   - it lies inside a longer seeded string;
//   - it is composed entirely of seeded strings joined by whitespace or punctuation;
//   - it fully matches a template literal a harness wrote, holes standing for anything.
//
// An argument to a method on the value under test (`out.error.includes("...")`)
// is the test searching output for wording and stays reported. The failure
// message argument of an assert method is never compared, so it is skipped.
//
// XML frames, key=value pairs and JSON bodies contain spaces too and are wire
// shapes, not prose; they are skipped by the same character test the Python
// gate uses.
import fs from "node:fs";
import path from "node:path";

const PROSE = /[A-Za-z]{2,} [A-Za-z]{2,}/;
const WIRE = /[<=>{}]/;
const GLUE = /^[\s\W]*/;

// How many values each node:assert method compares; anything past that is the message.
const ARITY = {
  assert: 1,
  ok: 1,
  equal: 2,
  notEqual: 2,
  strictEqual: 2,
  notStrictEqual: 2,
  deepEqual: 2,
  notDeepEqual: 2,
  deepStrictEqual: 2,
  notDeepStrictEqual: 2,
  match: 2,
  doesNotMatch: 2,
  throws: 1,
  doesNotThrow: 1,
  rejects: 1,
  doesNotReject: 1,
  ifError: 1,
  fail: 0,
};

// Strings a source text contains: "..." / '...' seeds, `...` templates as skeletons.
const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const HOLE = /\$\{[^}]*\}/;

function isProse(value) {
  return typeof value === "string" && PROSE.test(value) && !WIRE.test(value);
}

// `assert(...)` or `assert.<anything>(...)` — node:assert/strict in either form.
function isAssertion(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "assert";
  return callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "assert";
}

function insideAssertion(node) {
  for (let cur = node.parent; cur; cur = cur.parent) if (isAssertion(cur)) return true;
  return false;
}

function comparedArguments(node) {
  const method = node.callee.type === "Identifier" ? "assert" : node.callee.property.name;
  const arity = ARITY[method];
  const args = node.arguments;
  return arity !== undefined && args.length > arity ? args.slice(0, -1) : args;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A template's literal parts, or null when none of them is prose (a skeleton
// made only of holes would cover everything).
function skeleton(parts) {
  if (!parts.some(isProse)) return null;
  return new RegExp(`^${parts.map(escapeRegExp).join("[^]*")}$`);
}

function unescape(text) {
  return text.replace(/\\(.)/g, "$1");
}

// Every string a file's source text carries, without parsing it: harness modules
// are test-owned, so nothing in them can be copy.
function stringsOf(source) {
  const seeds = [];
  const skeletons = [];
  for (const m of source.matchAll(STRING)) {
    if (m[3] === undefined) {
      seeds.push(unescape(m[1] ?? m[2]));
      continue;
    }
    const parts = m[3].split(HOLE).map(unescape);
    if (parts.length === 1) seeds.push(parts[0]);
    else {
      const pattern = skeleton(parts);
      if (pattern) skeletons.push(pattern);
    }
  }
  return { seeds, skeletons };
}

function testsRoot(filename) {
  let dir = path.dirname(filename);
  while (path.basename(dir) !== "tests") {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

const IMPORTED = new Map();

function importedStrings(filename, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(filename), specifier);
  const root = testsRoot(filename);
  if (!root || !target.startsWith(root + path.sep) || !fs.existsSync(target)) return null;
  if (!IMPORTED.has(target)) IMPORTED.set(target, stringsOf(fs.readFileSync(target, "utf8")));
  return IMPORTED.get(target);
}

function isString(node) {
  return node.type === "Literal" && typeof node.value === "string";
}

function isPlainCall(node) {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name !== "assert";
}

function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) for (const v of value) v && typeof v.type === "string" && out.push(v);
    else if (value && typeof value.type === "string") out.push(value);
  }
  return out;
}

// Sort the strings under a compared argument into the ones the assertion looks
// for and the ones it hands to a plain function as input.
function split(node, asserted, handed) {
  if (isString(node)) return void asserted.push(node);
  if (isPlainCall(node)) {
    for (const arg of node.arguments) collect(arg, handed);
    return;
  }
  for (const child of children(node)) split(child, asserted, handed);
}

function collect(node, into) {
  if (isString(node)) into.push(node.value);
  else if (node.type === "TemplateLiteral" && node.quasis.length === 1) into.push(node.quasis[0].value.cooked);
  for (const child of children(node)) collect(child, into);
}

function composed(text, seeds, from = 0) {
  const pos = from + GLUE.exec(text.slice(from))[0].length;
  if (pos === text.length) return true;
  return seeds.some((seed) => text.startsWith(seed, pos) && composed(text, seeds, pos + seed.length));
}

function covered(text, pool) {
  if (pool.seeds.has(text) || pool.texts.some((t) => t.includes(text))) return true;
  if (pool.skeletons.some((p) => p.test(text))) return true;
  return composed(text, pool.pieces);
}

export default {
  meta: {
    type: "problem",
    docs: { description: "never assert a string the test did not seed itself (docs/testing.md rule 9)" },
    schema: [],
    messages: {
      copy: "asserts copy {{text}} — assert a wire identifier, a data-* state or a number, never a sentence",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const seeds = new Set();
    const skeletons = [];
    const asserted = [];
    const seed = (value) => typeof value === "string" && value !== "" && seeds.add(value);
    return {
      ImportDeclaration(node) {
        const strings = importedStrings(filename, node.source.value);
        if (!strings) return;
        strings.seeds.forEach(seed);
        skeletons.push(...strings.skeletons);
      },
      Literal(node) {
        if (isString(node) && !insideAssertion(node)) seed(node.value);
      },
      TemplateLiteral(node) {
        if (insideAssertion(node)) return;
        const parts = node.quasis.map((q) => q.value.cooked);
        if (parts.length === 1) return void seed(parts[0]);
        const pattern = skeleton(parts);
        if (pattern) skeletons.push(pattern);
      },
      CallExpression(node) {
        if (!isAssertion(node) || insideAssertion(node)) return;
        const handed = [];
        for (const arg of comparedArguments(node)) split(arg, asserted, handed);
        handed.forEach(seed);
      },
      "Program:exit"() {
        const texts = [...seeds];
        const pieces = texts.filter((s) => PROSE.test(s));
        const pool = { seeds, texts, skeletons, pieces };
        for (const node of asserted) {
          if (!isProse(node.value) || covered(node.value, pool)) continue;
          context.report({ node, messageId: "copy", data: { text: JSON.stringify(node.value) } });
        }
      },
    };
  },
};
