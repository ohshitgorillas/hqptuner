// Apply-report summarization: turns the backend's apply report into the
// {ok, text} pair the apply pill and the pending bar both render.
//
// Pure — it reads no signal and imports nothing from the store — which is why it
// can sit outside the three-tree modules with no risk of an import cycle and no
// signal crossing a file boundary. store/actions.js imports `summarize`; the
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
  // Name the fields that didn't converge. "unconverged" alone is undebuggable —
  // it says a setting the daemon kept refusing exists, but not which one, and
  // the user is the only one who can see their own config.
  const fields = Object.keys(p.diff || {});
  const which = fields.length ? `: ${fields.join(", ")}` : "";
  return failure(`Config not applied (${p.reason || "unconfirmed"})${which}`);
}

// How a switch target names itself in the report. The empty name is the picker's
// "(no preset)" — dropping the active-preset bookmark — so quoting it as a preset
// name would print `Switched to ""`.
const switchName = (sw) => (sw.name ? `"${sw.name}"` : "(no preset)");

// What went right, before the save lane is appended.
function successText(sw, count) {
  const changes = count ? `${count} change${count === 1 ? "" : "s"}` : "";
  if (!sw) return `Applied ${changes || "no changes"}`;
  return `Switched to ${switchName(sw)}${changes ? ` + ${changes}` : ""}`;
}

// The save lane's outcome, appended to what the apply itself did. A WARNED save
// is still a save: the preset is on disk and only hqplayerd's own mirror of it is
// behind, so it reads as a success carrying the caveat rather than a failure —
// reporting it as failed is what sent a user hunting for a preset already there.
function savedSummary(base, saved) {
  if (!saved) return { ok: true, text: base };
  if (!saved.ok) return failure(`${base} — save to "${saved.name}" failed: ${saved.error}`);
  const caveat = saved.warning ? ` — ${saved.warning}` : "";
  return { ok: true, text: `${base} · saved to "${saved.name}"${caveat}` };
}

export function summarize(report, count) {
  const sw = report.switched;
  const failed =
    liveFailure(report) ||
    (sw && !sw.active ? failure(`Switch to ${switchName(sw)} did not take`) : null) ||
    persistentFailure(report.persistent);
  if (failed) return failed;

  return savedSummary(successText(sw, count), report.saved);
}
