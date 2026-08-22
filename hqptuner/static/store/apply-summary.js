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
 * @typedef {object} Verdict
 *   What the apply pill and the pending bar render. `text` is the sentence the
 *   reader gets and is the owner's to reword; `code` names WHICH outcome this
 *   is, and the fields beside it carry the parts the sentence interpolates. An
 *   apply has two axes — what the apply itself did, and how its preset save went
 *   — so `save` rides alongside `code` rather than replacing it.
 *
 *   `lastApply` is annotated with this type rather than left to inference:
 *   `signal(null)` alone infers `any`, and a caller reading a field name that
 *   does not exist would then type-check clean. The annotation is structural
 *   (`{value: …}`) because the vendored @preact/signals typings export no
 *   `Signal` name, and `.value` is the whole of what callers touch.
 * @property {boolean} ok
 * @property {string} code
 * @property {string} text
 * @property {string[]} [settings] live setters that were refused (live-failed)
 * @property {string[]} [fields] fields that did not converge (persist-refused)
 * @property {string} [reason] why the persistent lane declined (persist-refused)
 * @property {string} [endpoint] the output endpoint that was absent (endpoint-missing)
 * @property {string} [preset] the preset switched to, or saved into
 * @property {number} [changes] staged edits the apply carried
 * @property {string} [save] "ok" | "failed" | "warned", absent when nothing was saved
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
 *   The config lane's outcome (http.restore).
 * @property {boolean} [submitted]
 * @property {boolean} [applied]
 * @property {string} [reason] unconverged | unavailable
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

/**
 * @param {string} code
 * @param {string} text
 * @param {Partial<Verdict>} [data] the parts the sentence interpolates
 * @returns {Verdict}
 */
const failure = (code, text, data) => ({ ok: false, code, text, ...data });

// A live setter that didn't take. Reported first and alone — a rejected setting
// is the most actionable thing the report can carry.
/**
 * @param {ApplyReport} report
 * @returns {Verdict | null}
 */
function liveFailure(report) {
  const fails = (report.live || []).filter((x) => !x.ok);
  if (!fails.length) return null;
  const settings = fails.map((f) => f.setting);
  return failure("live-failed", `Failed: ${settings.join(", ")}`, { settings });
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
  if (nd)
    return failure("endpoint-missing", `Endpoint "${nd.want}" not present — config not applied`, {
      endpoint: nd.want,
    });
  if (p.error) return failure("persist-error", `Config not applied: ${p.error}`);
  // Name the fields that didn't converge. "unconverged" alone is undebuggable —
  // it says a setting the daemon kept refusing exists, but not which one, and
  // the user is the only one who can see their own config.
  const fields = Object.keys(p.diff || {});
  const which = fields.length ? `: ${fields.join(", ")}` : "";
  const reason = p.reason || "unconfirmed";
  return failure("persist-refused", `Config not applied (${reason})${which}`, { reason, fields });
}

// How a switch target names itself in the report. The empty name is the picker's
// "(no preset)" — dropping the active-preset bookmark — so quoting it as a preset
// name would print `Switched to ""`.
const switchName = (/** @type {SwitchResult} */ sw) => (sw.name ? `"${sw.name}"` : "(no preset)");

// What went right, before the save lane is appended.
/**
 * @param {SwitchResult | undefined} sw absent when the apply switched no preset
 * @param {number} count
 * @returns {Verdict}
 */
function success(sw, count) {
  const changes = count ? `${count} change${count === 1 ? "" : "s"}` : "";
  if (!sw) return { ok: true, code: "applied", text: `Applied ${changes || "no changes"}`, changes: count };
  return {
    ok: true,
    code: "switched",
    text: `Switched to ${switchName(sw)}${changes ? ` + ${changes}` : ""}`,
    preset: sw.name,
    changes: count,
  };
}

// The save lane's outcome, appended to what the apply itself did. A WARNED save
// is still a save: the preset is on disk and only hqplayerd's own mirror of it is
// behind, so it reads as a success carrying the caveat rather than a failure —
// reporting it as failed is what sent a user hunting for a preset already there.
/**
 * @param {Verdict} base what the apply itself did
 * @param {SaveResult} [saved] absent when the apply saved no preset
 * @returns {Verdict}
 */
function savedSummary(base, saved) {
  if (!saved) return base;
  const { code, text } = base;
  if (!saved.ok)
    return failure(code, `${text} — save to "${saved.name}" failed: ${saved.error}`, {
      ...base,
      ok: false,
      save: "failed",
      preset: saved.name,
    });
  const caveat = saved.warning ? ` — ${saved.warning}` : "";
  return {
    ...base,
    text: `${text} · saved to "${saved.name}"${caveat}`,
    save: saved.warning ? "warned" : "ok",
    preset: saved.name,
  };
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
    (sw && !sw.active
      ? failure("switch-failed", `Switch to ${switchName(sw)} did not take`, { preset: sw.name })
      : null) ||
    persistentFailure(report.persistent);
  if (failed) return failed;

  return savedSummary(success(sw, count), report.saved);
}
