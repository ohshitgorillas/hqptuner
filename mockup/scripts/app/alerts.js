// Alerts: the mock alerts the scenario strip's picks raise, onto their homes. Their homes are every drawer and the Settings
// body, so this runs last: the page reports the scenario it opened on, closes every drawer, then mounts the alerts.

import { mountAlerts } from "../components/shell/alerts.js";
import { ALERT_COPY, MOCK_FIG } from "../data/shell/alerts.js";
import { LISTS } from "../data/lists/option-lists.js";
import { ENGINE } from "../data/shell/scenarios.js";
import { engineRow, raisedAlerts } from "../../../hqptuner/static/model/shell/app.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */

/**
 * Wire the alerts and open the page; app.raise and app.alerts are set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireAlerts(app) {
  const { bus, stages, plate } = app;
  const clipCtr = { lamp: el(".engine .counter .lamp"), n: el(".engine .counter .cnt") };
  const clip0 = { bad: clipCtr.lamp.classList.contains("bad"), n: clipCtr.n.textContent };
  /** The picks as alerts where v1's would fire (model/app.js raisedAlerts); the engine row reads what they read. */
  app.raise = () => {
    if (!app.alerts) return;
    const { conversion } = app;
    const p = conversion.path(),
      run = conversion.running(),
      st = conversion.state();
    const rf = el(".v", stages.get("resampling")).textContent;
    const raised = raisedAlerts(
      { p, run, st, picked: /** @type {Set<string>} */ (app.picked), rf, scene: app.scene },
      { lists: LISTS, copy: ALERT_COPY, fig: MOCK_FIG },
    );
    const row = engineRow(raised, p, ENGINE, MOCK_FIG);
    app.gaugeSet(row.speed);
    clipCtr.lamp.classList.toggle("bad", row.clip || clip0.bad);
    clipCtr.n.textContent = row.clip ? `${MOCK_FIG.clips} this track` : clip0.n;
    app.alerts.set(raised);
  };

  // Everything that shows playback, for the scenario opened on (some of it mounted after the first report).
  app.onPath(app.conversion.path(), app.conversion.running());
  // Opens on the page, every drawer closed.
  app.source.setOpen(false);
  // Alerts onto their homes: mounted after every drawer and the Settings body, which it pins lines into.
  app.alerts = mountAlerts({ plate, stages, srail: el("#srail"), bus });
  app.raise();
}
