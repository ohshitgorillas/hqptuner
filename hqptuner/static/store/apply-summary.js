// Apply-report summarization: turns the backend's apply report into the
// {ok, text} pair the apply pill and the pending bar both render.
//
// Pure — it reads no signal and imports nothing from the store — which is why it
// can sit outside the three-tree modules with no risk of an import cycle and no
// signal crossing a file boundary. store/actions.js imports `summarize`; the
// rest stays private to this module.

// `count` is the number of staged edits captured before apply — the http/matrix
// lanes each collapse many field edits into a single POST, so counting reports
// ("2 staged" -> "Applied 1 change") undercounts the real changes.
/**
 * @typedef {{ ok: boolean, text: string }} Verdict
 *   What the apply pill and the pending bar render.
 *
 * @typedef {object} LiveResult
 *   One live setter's outcome (writer.py, readback-verified).
 * @property {boolean} ok
 * @property {string} setting
 * @property {string} [error]
 *
 * @typedef {object} SwitchResult
 *   A preset switch's outcome (presetlane.switch). The empty name is the
 *   picker's "(no preset)".
 * @property {string} name
 * @property {boolean} [active] whether the daemon reports it loaded afterwards
 *
 * @typedef {object} PersistentResult
 *   The config lane's outcome (httplane).
 * @property {boolean} [submitted]
 * @property {boolean} [applied]
 * @property {string} [reason] unconverged | unavailable | unrestarted
 * @property {string} [error]
 * @property {Record<string, unknown>} [diff] the fields that did not converge
 * @property {{ net_device?: { want: string } }} [unfixable]
 *
 * @typedef {object} SaveResult
 *   The save lane's outcome. A WARNED save is still a save.
 * @property {boolean} ok
 * @property {string} name
 * @property {string} [error]
 * @property {string} [warning]
 *
 * @typedef {object} ApplyReport
 *   The whole apply report (core/applyops).
 * @property {LiveResult[]} [live]
 * @property {SwitchResult} [switched]
 * @property {PersistentResult} [persistent]
 * @property {SaveResult} [saved]
 */

const failure = (/** @type {string} */ text) => ({ ok: false, text });

// A live setter that didn't take. Reported first and alone — a rejected setting
// is the most actionable thing the report can carry.
/**
 * @param {ApplyReport} report
 * @returns {Verdict | null}
 */
function liveFailure(report) {
  const fails = (report.live || []).filter((x) => !x.ok);
  if (!fails.length) return null;
  return failure(`Failed: ${fails.map((f) => f.setting).join(", ")}`);
}

// The persistent lane declined. A missing output endpoint is named rather than
// folded into the generic message: it is the one cause with an obvious remedy
// (power the NAA back on), so it earns its own wording.
/**
 * @param {PersistentResult} [p] absent when the apply carried no persistent lane
 * @returns {Verdict | null}
 */
function persistentFailure(p) {
  if (!p || p.applied) return null;
  const nd = p.unfixable && p.unfixable.net_device;
  if (nd) return failure(`Endpoint "${nd.want}" not present — config not applied`);
  if (p.error) return failure(`Config not applied: ${p.error}`);
  // The daemon never restarted onto the uploaded config, so nothing was read back
  // from it. There are no diverged fields to name — the whole apply is unconfirmed.
  if (p.reason === "unrestarted") return failure("Config not applied — the daemon did not restart in time");
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
const switchName = (/** @type {SwitchResult} */ sw) => (sw.name ? `"${sw.name}"` : "(no preset)");

// What went right, before the save lane is appended.
/**
 * @param {SwitchResult | undefined} sw absent when the apply switched no preset
 * @param {number} count
 * @returns {string}
 */
function successText(sw, count) {
  const changes = count ? `${count} change${count === 1 ? "" : "s"}` : "";
  if (!sw) return `Applied ${changes || "no changes"}`;
  return `Switched to ${switchName(sw)}${changes ? ` + ${changes}` : ""}`;
}

// The save lane's outcome, appended to what the apply itself did. A WARNED save
// is still a save: the preset is on disk and only hqplayerd's own mirror of it is
// behind, so it reads as a success carrying the caveat rather than a failure —
// reporting it as failed is what sent a user hunting for a preset already there.
/**
 * @param {string} base
 * @param {SaveResult} [saved] absent when the apply saved no preset
 * @returns {Verdict}
 */
function savedSummary(base, saved) {
  if (!saved) return { ok: true, text: base };
  if (!saved.ok) return failure(`${base} — save to "${saved.name}" failed: ${saved.error}`);
  const caveat = saved.warning ? ` — ${saved.warning}` : "";
  return { ok: true, text: `${base} · saved to "${saved.name}"${caveat}` };
}

/**
 * The one-line verdict for an apply: the first failure the report carries, or what the
 * apply did plus how its preset save went.
 * @param {ApplyReport} report
 * @param {number} count staged edits, captured before the apply cleared them
 * @returns {Verdict}
 */
export function summarize(report, count) {
  const sw = report.switched;
  const failed =
    liveFailure(report) ||
    (sw && !sw.active ? failure(`Switch to ${switchName(sw)} did not take`) : null) ||
    persistentFailure(report.persistent);
  if (failed) return failed;

  return savedSummary(successText(sw, count), report.saved);
}
