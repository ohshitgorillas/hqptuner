// Frame and plate: the document and window listeners, the plate and its chain rail, the mock's scenario strip, the
// header's connection knob and station tree, the plate's option-list sheets and filter presets, and the page's Matrix
// response plot. Everything here mounts straight onto index.html's markup, ahead of the Setting Switcher and the drawers.

import { $ } from "../lib/shell/dom.js";
import { installPopovers } from "../lib/shell/popover.js";
import { installSheets } from "../lib/shell/sheet.js";
import { mountPlate, setSize, sizeOf, SIZES, SIZE, SIZE0 } from "../lib/shell/plate.js";
import { mountRail } from "../components/shell/rail.js";
import { mountScenario, mountAlertPicker, mountSizePicker } from "../components/shell/scenario.js";
import { mountConn } from "../components/shell/conn.js";
import { onApplied } from "../components/drawers/drawer.js";
import { mountStationTree } from "../components/shell/station-tree.js";
import { mountOptionList } from "../components/lists/option-list.js";
import { setListOpener } from "../components/lists/vselect.js";
import { mountFilterPresets } from "../components/page/filter-presets.js";
import { mountMatrixPlot } from "../components/page/matrix-plot.js";
import { CHAIN } from "../data/stages/chain.js";
import { SCENES } from "../data/shell/scenarios.js";
import { MOCK_ALERTS } from "../data/shell/alerts.js";
import { STATIONS } from "../data/builders/stations.js";
import { FIELDS, CHAIN_NAMES } from "../data/stages/conversion.js";
import { PRESETS } from "../data/lists/presets.js";

/**
 * Mount the plate, its rail and the page furniture on index.html; app.plate, app.stages, app.lamp, app.picked, app.conn,
 * app.tree and app.lists are set here.
 *
 * @param {object} app  the shared state (main.js)
 */
export function wireFrame(app) {
  const { bus, flags } = app;
  // Document listeners, before any component adds its own: popovers first (their Escape wins), then sheets.
  installPopovers();
  installSheets();
  // Anything that measures listens for `relayout`; the window's own resize reaches it here and nowhere else.
  window.addEventListener("resize", () => bus.emit("relayout"));

  const plate = $("#plate");
  app.plate = plate;
  mountPlate(plate, flags.size ?? SIZE0, bus);
  app.stages = mountRail($("#rail"), CHAIN, flags.wire, bus);
  // A rail stage's lamp: lit or dark (an off stage drops out of the wire), and its value when one is given.
  app.lamp = (st, on, value) => {
    st.classList.toggle("off", !on);
    st.querySelector(".lamp").classList.toggle("on", on);
    if (value !== undefined) st.querySelector(".v").textContent = value;
  };

  // ── Mock scenario: what is playing (switch above the plate; data/scenarios.js) ──────────────────────────────────────
  mountScenario($("#scene"), SCENES, app.scene.id, (id) => {
    app.scene = SCENES.find((s) => s.id === id);
    app.conversion.setScene(app.scene);
  });
  // Mock alerts (picker beside Scenario; data/alerts.js). raise() turns the picks into alerts where v1's would fire, onto
  // their homes (components/alerts.js, mounted last); every path change re-raises.
  app.picked = mountAlertPicker($("#scene"), MOCK_ALERTS, flags.alerts, (k) => {
    app.picked = k;
    app.raise();
  });
  // Mock display size (third group on the strip): the plate re-lays out at that iPad's landscape points (lib/plate.js).
  // 13″ also opens both Resampling filters (the idle one too) rather than stretch the Matrix section (SIZES both).
  mountSizePicker($("#scene"), SIZES, SIZE, (id) => {
    app.conversion.setRoom(!!sizeOf(id).both);
    setSize(id);
    app.paintFill();
  });

  // Brand knob = connection lamp; every drawer Apply restarts the engine (mock: the knob reads Applying… for a moment).
  app.conn = mountConn($("#conn"), flags.conn);
  onApplied(() => app.conn.applying());
  app.tree = mountStationTree($("#station-host"), STATIONS);
  // Option lists: every chain filter / dither / modulator picker (page, Resampling · Shaping drawer, Setting Switcher slots)
  // opens its whole list, narrowing built into its head: filters in a bottom sheet, modulators and dithers in a panel at the
  // picker (trigger).
  const lists = mountOptionList(plate, bus);
  app.lists = lists;
  setListOpener((o) => {
    const k = o.field.slice(3);
    const f = k === "sh" ? FIELDS[o.chain + "sh"] : FIELDS[k];
    lists.open({ ...o, title: f.label, sub: f.sub, band: CHAIN_NAMES[o.chain] });
  });
  mountFilterPresets(plate, $("#fpbtn"), PRESETS);
  mountMatrixPlot($("#mplot"), app.matrixPlot);

  // Anything measured at load (rail wire, page copy fit, narrowing tags) re-measures once the web fonts land: every measurer
  // listens for relayout.
  const remeasure = () => bus.emit("relayout");
  document.fonts?.ready.then(remeasure);
  document.fonts?.addEventListener("loadingdone", remeasure);
}
