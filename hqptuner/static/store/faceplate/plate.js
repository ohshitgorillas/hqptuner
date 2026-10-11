// The window the faceplate is fitted to, and the plate's size and scale for it. It imports no other store module, so
// any store module can read the plate's fit.

import { signal, computed } from "@preact/signals";
import { plateFit } from "../../model/shell/plate.js";

/** The window's inner size, CSS px. The entry writes it at load and on every resize. */
export const viewport = signal({ w: 1080, h: 810 });

/** The plate's size and scale for the window. */
export const plate = computed(() => plateFit(viewport.value));
