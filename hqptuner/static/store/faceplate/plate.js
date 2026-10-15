// The window the faceplate is fitted to, and the plate's layout and size for it under the display-format choice. Of
// the store it imports only the prefs module, which imports no store module, so any store module can read the plate's
// fit.

import { signal, computed } from "@preact/signals";
import { COMPACT, plateFit } from "../../model/shell/plate.js";
import { displayFormat } from "../ui/prefs.js";

/** The window's inner size, CSS px: the Compact format's until the plate mounts, then read from the window. */
export const viewport = signal({ w: COMPACT.w, h: COMPACT.h });

/** The plate's layout and size for the window and the display-format choice. */
export const plate = computed(() => plateFit(viewport.value, displayFormat.value));
