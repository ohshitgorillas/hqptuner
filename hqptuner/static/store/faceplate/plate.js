// The window the faceplate is fitted to, and the plate's format and scale for it under the display-format choice. Of
// the store it imports only the prefs module, which imports no store module, so any store module can read the plate's
// fit.

import { signal, computed } from "@preact/signals";
import { plateFit } from "../../model/shell/plate.js";
import { displayFormat } from "../ui/prefs.js";

/** The window's inner size, CSS px. The entry writes it at load and on every resize. */
export const viewport = signal({ w: 1080, h: 810 });

/** The plate's format and scale for the window and the display-format choice. */
export const plate = computed(() => plateFit(viewport.value, displayFormat.value));
