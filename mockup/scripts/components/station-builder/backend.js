// Backend step (wizard §1.1): NAA or ALSA, the manual's sentence beside each; a new backend clears the device picked.

import { h } from '../../lib/dom.js';
import { STB_COPY, STB_BACKENDS } from '../../data/station-builder.js';
import { choice, rich } from './parts.js';

/** The Backend step's rows. */
export function backendStep(sb) {
  return [
    choice('', STB_BACKENDS, sb.e.rec.backend, (v) => sb.set((x) => { if (x.backend !== v) Object.assign(x, { backend: v, listings: [], resolved: null }); })),
    h('div.stbnotes', {}, h('p', {}, rich(STB_COPY.combo))),
  ];
}
