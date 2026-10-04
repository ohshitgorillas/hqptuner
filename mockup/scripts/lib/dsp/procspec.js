// Process string ↔ stages (manual §7.1: `<plugin>:[arg1[=val]];[arg2[=val]];…`, comma-separated, case sensitive).
// Stages: {kind:'iir', type, f, g, q|bw|s | b0…a2} · {kind:'delay', s|t|d, v?} · {kind:'riaa', subsonic} ·
// {kind:'conv', file} (WAV) · {kind:'peqfile', file} (REW / AutoEq .txt). Raw input that won't parse is kept verbatim and
// flagged, never dropped (v1 round-trip contract).

/** @typedef {import('../../model/shell/pipelines.js').Stage} Stage */
/** @typedef {{ stages: Stage[] | null, error: string }} Parsed  the stages, or null and why the string won't parse */

/** @type {Readonly<Record<string, readonly string[]>>} */
const ORDER = {
  iir: ["type", "f", "q", "bw", "s", "g", "b0", "b1", "b2", "a0", "a1", "a2"],
  delay: ["s", "t", "d", "v"],
  riaa: ["subsonic"],
};

/**
 * One stage as the process string writes it: a plugin and its set arguments in wire order, or a file's name.
 *
 * @param {Stage} st
 * @returns {string}
 */
function stageSpec(st) {
  if (st.kind === "conv" || st.kind === "peqfile") return /** @type {string} */ (st.file);
  const keys = ORDER[st.kind].filter((k) => st[k] !== undefined && st[k] !== ""); // `blk` isn't wire
  return `${st.kind}:${keys.map((k) => `${k}=${st[k]}`).join(";")}`;
}

/**
 * A pipeline's stages as one process string, comma-separated.
 *
 * @param {Stage[]} stages
 * @returns {string}
 */
export const processSpec = (stages) => stages.map(stageSpec).join(",");

/**
 * One plugin stage from its kind and its `;`-separated arguments, or the first argument the plugin doesn't take.
 *
 * @param {string} kind  iir | delay | riaa
 * @param {string} args
 * @returns {Parsed}
 */
function pluginStage(kind, args) {
  /** @type {Stage} */
  const st = { kind };
  for (const kv of args.split(";").filter(Boolean)) {
    const [k, v] = kv.split("=");
    if (!ORDER[kind].includes(k)) return { stages: null, error: `Unknown argument “${k}” in ${kind}` };
    st[k] = k === "type" ? v : Number(v);
  }
  return { stages: [st], error: "" };
}

/**
 * One comma-separated part of a process string as its stage: a plugin, a WAV (conv) or a TXT (peqfile).
 *
 * @param {string} raw
 * @returns {Parsed}
 */
function partStage(raw) {
  const m = raw.match(/^(iir|delay|riaa):(.*)$/);
  if (m) return pluginStage(m[1], m[2]);
  if (/\.wav$/i.test(raw)) return { stages: [{ kind: "conv", file: raw }], error: "" };
  if (/\.txt$/i.test(raw)) return { stages: [{ kind: "peqfile", file: raw }], error: "" };
  return { stages: null, error: `Not a plugin, WAV or TXT: “${raw}”` };
}

/**
 * A process string's stages in order; the first part that won't parse stops it with null stages and the reason.
 *
 * @param {string} str
 * @returns {Parsed}
 */
export function parseProcess(str) {
  /** @type {Stage[]} */
  const stages = [];
  for (const raw of str
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const part = partStage(raw);
    if (!part.stages) return part;
    stages.push(...part.stages);
  }
  return { stages, error: "" };
}
