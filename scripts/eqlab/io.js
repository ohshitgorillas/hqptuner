// File-backed chain I/O: read chains from config-snapshot XML, ParametricEQ
// text and saved snapshots; write snapshots and ParametricEQ exports. Writes
// go to FILES ONLY — nothing in this module talks to the daemon.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rowToRewText } from "../../hqptuner/static/lib/eqexport.js";
import { parseEqText } from "../../hqptuner/static/lib/eqimport.js";
import { serializeProcess } from "../../hqptuner/static/lib/matrixspec.js";
import { curveOf, preampDb, round } from "./metrics.js";

// Same escape table as hqptuner/conf/matrixconf.py — order matters on
// unescape (&amp; last), and &apos; is present because the daemon writes it.
const ATTR_ESCAPES = [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&apos;"],
];

function attrUnescape(value) {
  let out = value;
  for (const [ch, ent] of [...ATTR_ESCAPES].reverse()) out = out.split(ent).join(ch);
  return out;
}

/**
 * The `<pipeline>` rows of a config-snapshot XML's `<matrix>` element, as
 * [{index, process}] sorted by channel. Scoped to the matrix body so saved
 * `<matrix_profile>` pipelines never leak in.
 */
export async function readXmlRows(path) {
  const text = await readFile(path, "utf8");
  const body = /<matrix\b[^>]*>([\s\S]*?)<\/matrix>/.exec(text);
  if (!body) throw new Error(`xml: no <matrix> element in ${path}`);
  const rows = [];
  for (const pm of body[1].matchAll(/<pipeline\b[^>]*\/>/g)) {
    const attrs = Object.fromEntries([...pm[0].matchAll(/\b(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    rows.push({ index: Number(attrs.channel ?? rows.length), process: attrUnescape(attrs.process ?? "") });
  }
  if (rows.length === 0) throw new Error(`xml: no <pipeline> rows in ${path}`);
  return rows.sort((a, b) => a.index - b.index);
}

/** Parse a ParametricEQ / REW / EQ APO text file into stages + provenance. */
export async function readParametricEq(path) {
  const { preamp, stages, skipped } = parseEqText(await readFile(path, "utf8"));
  if (stages.length === 0) throw new Error(`parametric_eq: no filters parsed from ${path}`);
  return { stages, preamp, skipped };
}

// ---------------------------------------------------------------------------
// Snapshot store — one JSON file per named chain, in a directory eqlab owns.

const DEFAULT_DIR = fileURLToPath(new URL("../../data/eqlab/", import.meta.url));

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

function snapshotPath(dir, name) {
  if (!NAME_RE.test(name || "")) {
    throw new Error(
      `snapshot: name must match ${NAME_RE} (letters, digits, ". _ -", no leading dot), got ${JSON.stringify(name)}`,
    );
  }
  return `${dir.replace(/\/$/, "")}/${name}.json`;
}

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Load a named snapshot: {name, saved_at, fs, process, ...} plus its path. */
export async function readSnapshot(spec) {
  const path = snapshotPath(spec.dir || DEFAULT_DIR, spec.name);
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`snapshot: cannot read ${path}: ${err.message}`);
  }
  if (typeof data.process !== "string") throw new Error(`snapshot: ${path} carries no process string`);
  return { ...data, path };
}

async function saveSnapshot(spec, ctx) {
  const dir = spec.dir || DEFAULT_DIR;
  const path = snapshotPath(dir, spec.save);
  if (!spec.overwrite && (await exists(path))) {
    throw new Error(`snapshot: ${path} exists — pass "overwrite": true to replace it`);
  }
  const curve = curveOf(ctx.stages, ctx.fs);
  const record = {
    name: spec.save,
    saved_at: new Date().toISOString(),
    fs: ctx.fs,
    source: ctx.source,
    process: serializeProcess(ctx.stages),
    band_count: ctx.stages.length,
    preamp_db: round(preampDb(curve), 2),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { saved: { ...record, path } };
}

async function listSnapshots(spec) {
  const dir = spec.dir || DEFAULT_DIR;
  let names;
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { dir, snapshots: [] };
  }
  const snapshots = [];
  for (const file of names) {
    const s = await readSnapshot({ dir, name: file.slice(0, -5) });
    snapshots.push({ name: s.name, saved_at: s.saved_at, fs: s.fs, band_count: s.band_count, preamp_db: s.preamp_db });
  }
  return { dir, snapshots };
}

/**
 * Snapshot job: {"kind":"snapshot","save":"name","overwrite":false} writes the
 * resolved chain as a named JSON file; {"kind":"snapshot","list":true} lists
 * the store (no chain needed). `dir` overrides the store directory.
 */
export function snapshotJob(spec, ctx) {
  if (spec.list) return listSnapshots(spec);
  if (typeof spec.save === "string") return saveSnapshot(spec, ctx);
  throw new Error('snapshot: give "save": "<name>" or "list": true');
}

// ---------------------------------------------------------------------------
// Export — the resolved chain as a ParametricEQ / REW / EQ APO text file.

/**
 * Export job: {"kind":"export","path":"...","format":"parametric_eq"}. The
 * Preamp line is COMPUTED from the chain's summed response (eqlab chains carry
 * band gains only, never a row gain), and the output says so.
 */
export async function exportJob(spec, ctx) {
  const format = spec.format || "parametric_eq";
  if (format !== "parametric_eq") throw new Error(`export: unknown format "${format}" (parametric_eq)`);
  if (!spec.path) throw new Error("export: needs a path");
  if (!spec.overwrite && (await exists(spec.path))) {
    throw new Error(`export: ${spec.path} exists — pass "overwrite": true to replace it`);
  }
  const preamp = round(preampDb(curveOf(ctx.stages, ctx.fs)), 2);
  const { text, count, skipped } = rowToRewText({
    process: serializeProcess(ctx.stages),
    gain: String(preamp),
    gainunit: "dB",
  });
  if (count === 0) throw new Error(`export: no exportable filters in chain (${skipped.join("; ") || "empty"})`);
  await writeFile(spec.path, text, "utf8");
  return { path: spec.path, format, filters: count, skipped, preamp_db: preamp, preamp_source: "computed_response" };
}
