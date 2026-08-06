// The assembled view model — the one thing components/LiveView.js reads. Its own
// module because it is the top of the lane: it names every part and nothing names
// it, so keeping it apart is what stops the parts reaching sideways for each
// other.
//
// This module does NOT import ./state.js, and that has one consequence worth
// knowing before you write a new consumer. state.js registers a load-time effect
// that clears liveErrors when the daemon reconnects; before this file was split
// out of store/live.js, importing ANY live-lane name registered that effect,
// because there was only one module. Now a consumer that takes liveModel alone
// would never load state.js, and stale per-field errors would survive a
// reconnect. Both current entry points are safe — LiveView.js also takes
// liveBusy/liveErrors/writeLive, and store/livepresets.js takes
// remirrorLive/reportError — so nothing is wrong today. A future reader-only
// consumer must import from ./state.js as well.

import { computed } from "@preact/signals";
import { engineState } from "../signals.js";
import { schema } from "../schema.js";
import { enumOptions } from "../options.js";
import { grayModesByDevice } from "../devicecaps.js";
import { catalog, modeValue, stateOf } from "./derive.js";
import { rateColumn } from "./rates.js";
import { chainControls } from "./chains.js";

// Everything the LIVE page renders, in one read. A single computed rather than a
// dozen exports: the controls are one picture of the engine, and building them
// apart is how a page ends up showing a filter from one poll beside a chain from
// the next.
export const liveModel = computed(() => {
  const chain = (engineState.value || {}).active_chain || null;
  return {
    chain,
    // `mode`'s config-form values are the stable strings auto/pcm/sdm, so its
    // option list is the catalog's own, not an enumeration.
    mode: {
      field: "mode",
      ...catalog("output_mode"),
      value: modeValue(),
      options: grayModesByDevice(schema.output_mode.options),
    },
    pcmRate: rateColumn("pcm"),
    sdmRate: rateColumn("sdm"),
    // The junk (playback) filter is index-domain on both sides: the daemon's own
    // /config form has no field for it, so the list index IS the value — which
    // is what enumOptions hands back, and what its per-option prose is keyed by.
    junk: {
      field: "junk_filter",
      ...catalog("junk_filter"),
      value: stateOf("filter_junk"),
      options: enumOptions("junk_filters"),
      enumBacked: true,
    },
    adaptive: { field: "adaptive_volume", ...catalog("adaptive_volume"), value: stateOf("adaptive") },
    pcmChain: chainControls("pcm", chain),
    sdmChain: chainControls("sdm", chain),
  };
});
