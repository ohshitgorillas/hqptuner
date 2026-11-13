// Control catalog, the speakers form's switch. Assembled into `schema` by
// store/schema.js.
//
// The speakers catalog uses the daemon's /speakers form (readme §1.9), never the
// config staging buffer: the value is its served reading, and the form's own
// POST writes it.

import { BYPASS_ENGAGE } from "./options.js";

/** @type {Record<string, SchemaField>} */
export const speakers = {
  spken: {
    label: "",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: BYPASS_ENGAGE,
  },
};
