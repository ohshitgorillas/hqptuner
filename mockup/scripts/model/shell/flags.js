// The mockup's URL flags, read once: main.js hands the page's URL fragment in and passes the result down. Viewing tools, not app
// state: each opens the mock on a case the faceplate can't reach by itself.
//   #size-<id>          display size (lib/plate.js SIZES)        #scene-<id>      scenario (data/scenarios.js)
//   #alerts-<k>,<k>     mock alerts raised (data/alerts.js)      #conn-busy|lost  connection lamp (components/conn.js)
//   #routed             the whole fragment: routed rail wire     #mode-auto       daemon left in Auto
//   #many | #long       snapshot set (data/snapshots.js)         #71|mch|dense    pipeline set (data/pipelines.js)
//   #naa-none #ipv6-fail #usb-fail-gone|none #dsd48-no           Station builder's mock checks

/**
 * @typedef {object} Flags
 * @property {string | null} size  a known display size id, else null
 * @property {string | null} scene  a known scenario id, else null
 * @property {string[]} alerts  known alert kinds, in fragment order
 * @property {'ok' | 'busy' | 'lost'} conn  connection lamp state
 * @property {'routed' | 'trunk'} wire  rail wire style
 * @property {boolean} modeAuto  the daemon was left in Auto
 * @property {'many' | 'long' | 'default'} snapshots  snapshot set
 * @property {'mch8' | 'mch' | 'dense' | 'stereo'} pipelines  pipeline set
 * @property {boolean} naaNone  an NAA shows only after Refresh devices
 * @property {boolean} ipv6Fail  the IPv6 check fails
 * @property {'gone' | 'none' | null} usbFail  how the USB check fails, else null
 * @property {boolean} dsd48No  the device detects no 48k DSD
 */

/**
 * Read every mock flag out of a URL fragment.
 *
 * @param {string} hash  the page's URL fragment, `#` included
 * @param {{ id: string }[]} sizes  display sizes the fragment may name
 * @param {{ id: string }[]} scenes  scenarios the fragment may name
 * @param {string[]} alertKinds  alert kinds the fragment may name
 * @returns {Flags}
 */
export function hashFlags(hash, sizes, scenes, alertKinds) {
  return {
    size: known(hash.match(/size-([\d.]+)/)?.[1], sizes),
    scene: known(hash.match(/scene-(\w+)/)?.[1], scenes),
    alerts: (hash.match(/alerts-([\w,]+)/)?.[1].split(",") ?? []).filter((k) => alertKinds.includes(k)),
    conn: /** @type {'busy' | 'lost' | undefined} */ (hash.match(/conn-(busy|lost)/)?.[1]) ?? "ok",
    wire: hash === "#routed" ? "routed" : "trunk",
    modeAuto: hash.includes("mode-auto"),
    snapshots: firstOf(
      hash,
      [
        ["many", "many"],
        ["long", "long"],
      ],
      "default",
    ),
    pipelines: firstOf(
      hash,
      [
        ["71", "mch8"],
        ["mch", "mch"],
        ["dense", "dense"],
      ],
      "stereo",
    ),
    naaNone: hash.includes("naa-none"),
    ipv6Fail: hash.includes("ipv6-fail"),
    usbFail: /** @type {'gone' | 'none' | undefined} */ (hash.match(/usb-fail-(gone|none)/)?.[1]) ?? null,
    dsd48No: hash.includes("dsd48-no"),
  };
}

/**
 * The id when one of `items` carries it, else null.
 *
 * @param {string | undefined} id
 * @param {{ id: string }[]} items
 */
const known = (id, items) => (id !== undefined && items.some((x) => x.id === id) ? id : null);

/**
 * The value of the first `[needle, value]` pair whose needle the fragment contains, else `fallback`.
 *
 * @template {string} T
 * @param {string} hash
 * @param {[string, T][]} pairs
 * @param {T} fallback
 * @returns {T}
 */
const firstOf = (hash, pairs, fallback) => pairs.find(([needle]) => hash.includes(needle))?.[1] ?? fallback;
