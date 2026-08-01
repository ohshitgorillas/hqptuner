// Junk-filter advice off the /api/status payload's `junk` object (the backend's
// metering-stream advisor). Advice, not an action: the chip only tells the user
// which junk filter — or filter family — would treat what was seen; they change
// it themselves. It clears by itself when the track changes or the engaged
// settings treat the detected signature (the backend decides what counts).
import { computed } from "@preact/signals";
import { engineStatus } from "./signals.js";

export const junkAdvice = computed(() => (engineStatus.value || {}).junk || null);
