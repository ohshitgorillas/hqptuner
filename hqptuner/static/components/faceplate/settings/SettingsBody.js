// The Settings body the gear swaps in for the chain: the category rail, the hairline, the About page, and one drawer
// per category over the page.

import { useEffect } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { Drawer } from "../drawer/Drawer.js";
import { loadHardware } from "../../../store/faceplate/settings/hardware.js";
import { SettingsRail } from "./SettingsRail.js";
import { About } from "./About.js";
import { CATEGORIES } from "./index.js";

/** The Settings body: rail, hairline, About, then each category's drawer. */
export function SettingsBody() {
  useEffect(() => {
    loadHardware();
  }, []);
  return html`
    <div class="body setbody" data-body="settings">
      <${SettingsRail} categories=${CATEGORIES} />
      <div class="vrule"></div>
      <${About} />
      ${CATEGORIES.map((c) => html`<${Drawer} key=${c.id} schema=${c.schema} blocks=${c.blocks} />`)}
    </div>
  `;
}
