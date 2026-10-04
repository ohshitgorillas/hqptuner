// Brand knob = connection lamp: v1's knob glyph back beside the mark, and the Connected pill folded
// into it. The ring is the light (v1 StatusPill's three states): ok = Connected (green), busy = Applying… (amber, the
// pointer sweeps while the engine restarts), lost = Unreachable (red, the pointer turned to off). The state word is the
// button's name and tooltip line; tap = v1's way into connection settings (that panel is not drawn).
// Mock: ok. `#conn-busy` / `#conn-lost` show the other states; every Apply flashes busy for 1.2 s (mock restart).

const STATES = {
  ok: 'Connected',
  busy: 'Applying…',
  lost: 'Unreachable',
};
// v1 StatusPill title (owner copy).
const HINT = "Open connection settings to set the HQPlayer Embedded server's IP address and authentication details.";

/** @param {HTMLButtonElement} btn */
export function mountConn(btn) {
  let state = 'ok', timer = 0;
  function set(s) {
    state = s;
    btn.dataset.state = s;
    btn.setAttribute('aria-label', `${STATES[s]}. Connection settings`);
    btn.title = `${STATES[s]} — ${HINT}`;
  }
  const hash = location.hash.match(/conn-(busy|lost)/);
  set(hash ? hash[1] : 'ok');
  return {
    set,
    /** An apply went out: the engine restarts under it (mock: 1.2 s), then back to what it was. */
    applying() {
      if (state === 'lost') return;
      clearTimeout(timer);
      set('busy');
      timer = setTimeout(() => set('ok'), 1200);
    },
  };
}
