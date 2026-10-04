// UPnP: http (restore lane, restart): upnp_freewheel.

import { OFF_ON } from "./common.js";

const MAN = {
  upnp: "Allows the entire track to be (pre-)fetched to memory at full network speed when the track size is known. This can cause a resource load spike when the fetch happens. It also has memory usage implications.",
};

// UPnP. The 6.0.4 form's own `UPnP` item and v1's UPnP
// card: one row, http restore lane (restarts).
/** @type {import('../stages/output.js').DrawerSchema} */
export const UPNP_DRAWER = {
  id: "upnp",
  title: "UPnP",
  aria: "UPnP settings",
  restart: true,
  tabs: [
    {
      id: "upnp",
      label: "UPnP",
      body: [
        {
          row: {
            label: "UPnP freewheel",
            man: MAN.upnp,
            control: { type: "seg", id: "freewheel", aria: "UPnP freewheel", value: "0", options: OFF_ON },
          },
        },
      ],
    },
  ],
};
