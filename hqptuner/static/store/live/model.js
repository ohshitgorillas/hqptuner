// The assembled view model of the live lane's controls. Its own module because it
// is the top of the lane: it names every part and nothing names it, so keeping it
// apart is what stops the parts reaching sideways for each other.

import { computed } from "@preact/signals";
import { engineState } from "../signals.js";
import { chainControls } from "./chains.js";

// Everything the live controls read, in one read. A single computed rather than a
// dozen exports: the controls are one picture of the engine, and building them
// apart is how a page ends up showing a filter from one poll beside a chain from
// the next.
export const liveModel = computed(() => {
  const chain = (engineState.value || {}).active_chain || null;
  return {
    chain,
    pcmChain: chainControls("pcm", chain),
    sdmChain: chainControls("sdm", chain),
  };
});
