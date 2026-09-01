// The chain the engine has LOADED — the one family question the engine alone
// can answer, and the only one a caller reading the mode from elsewhere still
// has to ask it (store/alerts/shaperfit.js).

import { engineState } from "../signals.js";

/** The family of the chain the engine has loaded, "" when it has none. */
export function loadedChain() {
  return (engineState.value || {}).active_chain || "";
}
