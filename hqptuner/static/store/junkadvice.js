// Junk-filter advice off the /api/status payload's `junk` object (the backend's
// metering-stream advisor). Advice, not an action: the chip only tells the user
// which junk filter to engage — they change it themselves. It clears by itself
// when the track changes or the engaged junk filter treats the detected
// signature (the backend decides what counts as treatment).
import { computed } from "@preact/signals";
import { engineStatus } from "./state.js";

export const junkAdvice = computed(() => (engineStatus.value || {}).junk || null);
