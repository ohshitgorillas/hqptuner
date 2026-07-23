// Pipeline `process` chain parser/serializer (manual §7.1). A chain is a
// comma-separated stage list; each stage is either a plugin spec
// ("<plugin>:arg;arg=val;...", plugins iir/delay/riaa, case-sensitive) or a
// filter-impulse filename (convolution). Round-trip contract (matrix-spec §4):
// parse(s) then serialize is byte-identical — each stage keeps its original
// `raw` string, regenerated only when the stage is edited (buildRaw).

const PLUGINS = new Set(["iir", "delay", "riaa"]);

export function parseProcess(str) {
  if (!str || !str.trim()) return [];
  return str.split(",").map((raw) => {
    const colon = raw.indexOf(":");
    // Head is trimmed for CLASSIFICATION only — `raw` stays byte-identical for
    // the round-trip. A bare plugin name with no colon ("riaa") is a legal
    // zero-arg spec, not a convolution filename.
    const head = (colon === -1 ? raw : raw.slice(0, colon)).trim();
    if (PLUGINS.has(head)) {
      const args = {};
      for (const part of (colon === -1 ? "" : raw.slice(colon + 1)).split(";")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        if (eq === -1) args[part] = "";
        else args[part.slice(0, eq)] = part.slice(eq + 1);
      }
      return { kind: head, args, raw };
    }
    return { kind: "conv", file: raw, raw };
  });
}

export function buildRaw(stage) {
  if (stage.kind === "conv") return stage.file;
  const args = Object.entries(stage.args)
    .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
    .join(";");
  return `${stage.kind}:${args}`;
}

export function serializeProcess(stages) {
  return stages.map((s) => (s.raw !== undefined ? s.raw : buildRaw(s))).join(",");
}

// Everything in a chain that ISN'T parametric EQ, order preserved. Loading a
// headphone profile replaces the previous profile rather than stacking on it,
// but "the previous profile" means the iir stages — a delay, a RIAA curve or a
// convolution someone put in the same chain is not EQ and is not ours to drop.
export function withoutEq(process) {
  return serializeProcess(parseProcess(process).filter((s) => s.kind !== "iir"));
}

// --- stage editor support (matrix-spec step 4) -------------------------------

// Per-plugin argument schema (manual §7.2–7.4, case-sensitive). IIR types list
// their required args plus a one-of group (q OR bw OR s per type); biquad is
// raw coefficients. Values are free decimal strings — the daemon parses them.
export const IIR_TYPES = {
  lp: { args: ["f"], oneOf: ["q", "s"] },
  lp1: { args: ["f"] },
  hp: { args: ["f"], oneOf: ["q", "s"] },
  hp1: { args: ["f"] },
  bp: { args: ["f"], oneOf: ["q", "bw"] },
  ap: { args: ["f"], oneOf: ["q", "bw"] },
  notch: { args: ["f"], oneOf: ["q", "bw"] },
  peak: { args: ["f", "g"], oneOf: ["q", "bw"] },
  lshelf: { args: ["f", "g"], oneOf: ["q", "s"] },
  hshelf: { args: ["f", "g"], oneOf: ["q", "s"] },
  biquad: { args: ["b0", "b1", "b2", "a0", "a1", "a2"] },
};
export const DELAY_ARGS = ["s", "t", "d", "v"];

const NUM = /^-?\d+(\.\d+)?([eE]-?\d+)?$/;

// Issues for one stage, as plain strings. A stage with issues still renders and
// still serializes — validation informs, it never drops or rewrites user input.
export function validateStage(stage) {
  if (stage.kind === "conv") {
    return stage.file.trim() ? [] : ["convolution stage has no file"];
  }
  if (stage.kind === "riaa") {
    return Object.entries(stage.args).flatMap(([k, v]) => {
      if (k !== "subsonic") return [`unknown riaa argument "${k}"`];
      return v === "0" || v === "1" ? [] : ["subsonic must be 0 or 1"];
    });
  }
  if (stage.kind === "delay") {
    const issues = Object.entries(stage.args).flatMap(([k, v]) =>
      !DELAY_ARGS.includes(k) ? [`unknown delay argument "${k}"`] : NUM.test(v) ? [] : [`${k} must be a number`],
    );
    if (!["s", "t", "d"].some((k) => k in stage.args)) issues.push("delay needs s, t, or d");
    return issues;
  }
  // iir
  const type = stage.args.type;
  const schema = IIR_TYPES[type];
  if (!schema) return [type ? `unknown iir type "${type}"` : "iir stage has no type"];
  const known = new Set(["type", ...schema.args, ...(schema.oneOf || [])]);
  const issues = Object.entries(stage.args).flatMap(([k, v]) => {
    if (k === "type") return [];
    if (!known.has(k)) return [`"${k}" does not apply to ${type}`];
    return NUM.test(v) ? [] : [`${k} must be a number`];
  });
  for (const req of schema.args) {
    if (!(req in stage.args)) issues.push(`${type} needs ${req}`);
  }
  if (schema.oneOf) {
    const present = schema.oneOf.filter((k) => k in stage.args);
    if (present.length === 0) issues.push(`${type} needs ${schema.oneOf.join(" or ")}`);
    if (present.length > 1) issues.push(`use only one of ${schema.oneOf.join("/")}`);
  }
  return issues;
}

// Fresh stage of a kind, with sensible defaults (add-stage lands editable).
export function newStage(kind) {
  if (kind === "conv") return { kind, file: "", raw: undefined };
  if (kind === "delay") return { kind, args: { t: "0.01" }, raw: undefined };
  if (kind === "riaa") return { kind, args: { subsonic: "1" }, raw: undefined };
  return { kind: "iir", args: { type: "peak", f: "1000", q: "1", g: "0" }, raw: undefined };
}

// A stage rebuilt after an edit: raw regenerates from params in schema order
// (type, f, q/bw/s, g / coefficients), case-sensitively.
export function editedStage(stage, patch) {
  if (stage.kind === "conv") {
    const next = { ...stage, ...patch };
    return { ...next, raw: next.file };
  }
  const args = { ...stage.args, ...patch };
  for (const k of Object.keys(args)) {
    if (args[k] === "" || args[k] === undefined) delete args[k];
  }
  const order =
    stage.kind === "iir"
      ? ["type", "f", "q", "bw", "s", "g", "b0", "b1", "b2", "a0", "a1", "a2"]
      : stage.kind === "delay"
        ? DELAY_ARGS
        : ["subsonic"];
  const ordered = {};
  for (const k of order) {
    if (k in args) ordered[k] = args[k];
  }
  const next = { ...stage, args: ordered };
  return { ...next, raw: buildRaw(next) };
}

// Chip label: the shortest string that identifies the stage at a glance.
export function stageLabel(stage) {
  if (stage.kind === "conv") {
    const base = stage.file.split("/").pop();
    return base || stage.file;
  }
  if (stage.kind === "iir") {
    const a = stage.args;
    const bits = [a.type || "iir"];
    if (a.f) bits.push(`${a.f} Hz`);
    if (a.g) bits.push(`${a.g} dB`);
    return bits.join(" · ");
  }
  if (stage.kind === "delay") {
    const a = stage.args;
    const v = a.t ? `${a.t} s` : a.s ? `${a.s} smp` : a.d ? `${a.d} m` : "";
    return v ? `delay · ${v}` : "delay";
  }
  return stage.kind; // riaa
}
