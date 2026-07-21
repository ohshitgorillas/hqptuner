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
    const head = colon === -1 ? "" : raw.slice(0, colon);
    if (PLUGINS.has(head)) {
      const args = {};
      for (const part of raw.slice(colon + 1).split(";")) {
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
