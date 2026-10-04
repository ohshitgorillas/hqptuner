// Signal path: every path HQPlayer can take, the one playing lit (components/signal-path.js). Read-only: nothing stages.
/** @type {import('../stages/output.js').DrawerSchema} */
export const SIGPATH_DRAWER = {
  id: "sigpath",
  title: "Signal path",
  aria: "Signal path",
  restart: false,
  tabs: [{ id: "sigpath", label: "Signal path", body: [{ block: "sigpath" }] }],
};
