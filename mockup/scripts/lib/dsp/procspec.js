// Process string ↔ stages (manual §7.1: `<plugin>:[arg1[=val]];[arg2[=val]];…`, comma-separated, case sensitive).
// Stages: {kind:'iir', type, f, g, q|bw|s | b0…a2} · {kind:'delay', s|t|d, v?} · {kind:'riaa', subsonic} ·
// {kind:'conv', file} (WAV) · {kind:'peqfile', file} (REW / AutoEq .txt). Raw input that won't parse is kept verbatim and
// flagged, never dropped (v1 round-trip contract).

const ORDER = {
  iir: ["type", "f", "q", "bw", "s", "g", "b0", "b1", "b2", "a0", "a1", "a2"],
  delay: ["s", "t", "d", "v"],
  riaa: ["subsonic"],
};

export function stageSpec(st) {
  if (st.kind === "conv" || st.kind === "peqfile") return st.file;
  const keys = ORDER[st.kind].filter((k) => st[k] !== undefined && st[k] !== ""); // `blk` isn't wire
  return `${st.kind}:${keys.map((k) => `${k}=${st[k]}`).join(";")}`;
}
export const processSpec = (stages) => stages.map(stageSpec).join(",");

/** @returns {{stages: object[], error: string}} */
export function parseProcess(str) {
  const stages = [];
  for (const raw of str
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = raw.match(/^(iir|delay|riaa):(.*)$/);
    if (m) {
      const st = { kind: m[1] };
      for (const kv of m[2].split(";").filter(Boolean)) {
        const [k, v] = kv.split("=");
        if (!ORDER[m[1]].includes(k)) return { stages: null, error: `Unknown argument “${k}” in ${m[1]}` };
        st[k] = k === "type" ? v : Number(v);
      }
      stages.push(st);
    } else if (/\.wav$/i.test(raw)) stages.push({ kind: "conv", file: raw });
    else if (/\.txt$/i.test(raw)) stages.push({ kind: "peqfile", file: raw });
    else return { stages: null, error: `Not a plugin, WAV or TXT: “${raw}”` };
  }
  return { stages, error: "" };
}
