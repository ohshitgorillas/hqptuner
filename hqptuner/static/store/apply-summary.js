// Apply-report summarization: turns the backend's apply report into the
// {ok, text} pair the apply pill and the pending bar both render.
//
// Pure — it reads no signal and imports nothing from store/state.js — which is
// why it can sit outside the three-tree module with no risk of an import cycle
// and no signal crossing a file boundary. state.js imports `summarize`; the
// rest stays private to this module.

// `count` is the number of staged edits captured before apply — the http/matrix
// lanes each collapse many field edits into a single POST, so counting reports
// (the old bug: "2 staged" -> "Applied 1 change") undercounts the real changes.
const failure = (text) => ({ ok: false, text });

// A live setter that didn't take. Reported first and alone — a rejected setting
// is the most actionable thing the report can carry.
function liveFailure(report) {
  const fails = (report.live || []).filter((x) => !x.ok);
  if (!fails.length) return null;
  return failure(`Failed: ${fails.map((f) => f.setting).join(", ")}`);
}

// The persistent lane declined. A missing output endpoint is named rather than
// folded into the generic message: it is the one cause with an obvious remedy
// (power the NAA back on), so it earns its own wording.
function persistentFailure(p) {
  if (!p || p.applied) return null;
  const nd = p.unfixable && p.unfixable.net_device;
  if (nd) return failure(`Endpoint "${nd.want}" not present — config not applied`);
  if (p.error) return failure(`Config not applied: ${p.error}`);
  return failure(`Config not applied (${p.reason || "unconfirmed"})`);
}

// What went right, before the save lane is appended.
function successText(sw, count) {
  const changes = count ? `${count} change${count === 1 ? "" : "s"}` : "";
  if (!sw) return `Applied ${changes || "no changes"}`;
  return `Switched to "${sw.name}"${changes ? ` + ${changes}` : ""}`;
}

export function summarize(report, count) {
  const sw = report.switched;
  const failed =
    liveFailure(report) ||
    (sw && !sw.active ? failure(`Switch to "${sw.name}" did not take`) : null) ||
    persistentFailure(report.persistent);
  if (failed) return failed;

  const base = successText(sw, count);
  const saved = report.saved;
  if (saved && !saved.ok) return failure(`${base} — save to "${saved.name}" failed: ${saved.error}`);
  if (saved) return { ok: true, text: `${base} · saved to "${saved.name}"` };
  return { ok: true, text: base };
}
