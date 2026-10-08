# Design system — frontend layout (binding)

The faceplate rules bind every stylesheet under `hqptuner/static/css/`. All visual work conforms or flags deviation.

## The faceplate

The target is `docs/faceplate-spec.md`. A tuner or integrated-amp faceplate, dark only.

### Plate

- **Three sizes, iPad landscape in points:** 1080×810 (10.2″, the smallest and the design size), 1180×820 (11″) and 1366×1024 (13″). `--plate-w` and `--plate-h` carry the picked size.
- **The plate is laid out at the picked size and reflows into it:** rail stages flex, the one `.fill` section takes the spare height, drawers and bodies widen. It renders 1:1 and scales down only below its size, never up.
- **Everything fits without scrolling at every size**, checked with the real fonts.

### One surface, no cards

- **The plate is the one surface.** A section is an engraved header and a hairline, never a framed panel. No `.card`, `.card-head` or `.card-body`, in markup or in a stylesheet, and no rounded panel painted in the plate's own fill under another name.
- **No two-track pack grid.** Every page section uses the same two columns, controls on the left and copy or a plot on the right. One field is open per section; the others fold to one line.
- **Surfaces, by role:** `--page` (the room behind the plate) · `--plate` and `--plate-2` (the plate, and a flat face on it: a disabled button, a bar) · `--glass` (VFD windows, segments, meters, plots) · `--pop` (popover sheets) · `--hover` (a row under the pointer inside a popover) · `--lamp-off` (an unlit lamp).
- **Finishes are whole tokens:** `--raised` and `--raised-shadow` (a push button), `--well` (the inset shadow of a glass window), `--key` (the glass key at the end of a split control), `--pop-shadow`, `--plate-face`.
- **Lines, by role:** `--line` (hairline rules) · `--line-2` (control borders, the wire trace) · `--edge` (the plate bezel, minor dial ticks) · `--seam` (between segment buttons) · `--row-rule` (drawer row separators) · `--highlight` (the top-edge bevel light).
- **Hatch marks only what cannot or does not run:** an unavailable rate tier, an idle chain head.

### Ink

- **Four inks and one dead ink:** `--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--ink-dead`.
- **Text is never darker than `--ink-2`.** `--ink-3`, `--ink-4` and `--acc-dim` are for strokes, rules and dead states (disabled, unavailable, off). `--ink-dead` is the lettering of an unlit legend.
- **Off is an unlit lamp, never a grayed stage.**

### Accent and fixed colors

- **The accent is the user's pick, amber by default:** `--acc`, `--acc-dim`, `--acc-lo`, with `--acc-rim` and the glows derived from it. A glow names `--acc-glow`, `--acc-glow-hi` or `--acc-halo`, never a hex.
- **The accent marks what you set and where you are:** a value in a VFD window, a setting segment's fill, the traces and handles of a setting's plot, dirty dots; the left-hand selection bar, the open stage, a view or tab pick's foot, focus, links. Never a measurement, a semantic state, a drawing, a button's resting face or a read-only readout.
- **Fixed colors never follow the accent:** instrument amber `--meter*` and the spectrogram ramp `--spec-0..5` for measurements, `--warn`, `--busy`, and the lamps `--ok` and `--bad`. Anything that must stay amber uses these, not `--acc`.
- **No new green lamps.** Running state is shown with lettering.
- **Selection bars are left-hand everywhere.**
- **No raw color outside `tokens.css` (gated).** A shade used once still gets a name there.

### Type

- **Three families, by role:** `--f-eng` (Saira Extra Condensed, engraved legends) · `--f-mono` (IBM Plex Mono, readouts and engine strings) · `--f-body` (IBM Plex Sans). `font-family` names one of these tokens and nothing else (gated). The three are self-hosted under `hqptuner/static/fonts/`, each with its license, and declared in `hqptuner/static/css/v2/tokens.css`.
- **Line heights are pinned, never `normal` (gated):** `--lh-eng` for Saira, `--lh-text` for the Plex faces, or a number. `normal` follows each font file's own metrics, which differ by browser and by fallback, and moves text off the plate. A rule that sets a font family sets its line height or inherits one.
- **Small print has one size per role:** `--fs-cl` (a control's label) and `--fs-u` (a unit after a value). Other sizes are literal pixels at the design size.
- **Every control, axis and readout labels its unit.** Units keep their own case inside an uppercase legend.

### Spacing

- **Spacing is fixed, in pixels at the design size:** 22px between page sections, 10px from a section's header to its body. Spare height is never spread as gaps between sections; the one `.fill` section takes it.
- **A drawer that overflows first narrows its control column**, bringing the copy closer to its control, before anything else gives.
- **Sizes that recur are tokens.** A literal size, space or radius is legal in a faceplate stylesheet; a value written a second time for the same role moves to `tokens.css`.

### Motion

- **A transition or an animation names a motion token or is `none` (gated).** No literal duration outside `tokens.css`.
- **Alert blink:** `--blink`, one second, stepped, on the alert's home: a lamp, a ring or lettering. Red is critical, amber is a warning or advice; fixed colors, never the accent. The blink overlays the lamp's state, so an unlit lamp blinks too. Several alerts on one home: the worst sets the blink.
- **Knob sweep:** `--knob-sweep`, the brand knob's pointer circling while the engine applies; `--knob-turn` settles the pointer on a state.
- **Wipes and followers:** `--wipe` (a drawer or sheet opening, one wipe at a time), `--needle` (the rate dial), `--fade` (a panel).
- **Reduced motion is steady.** Under `prefers-reduced-motion: reduce` an alert holds its color without blinking. One blink stays, at `--blink-slow`: the critical ring on the brand knob, because steady red there already means Unreachable.

### Gates

- `scripts/gates/css/check_css_tokens.py` holds a faceplate stylesheet to the gated rules above: color, line height, font family, motion.
- `scripts/gates/css/check_css_cards.py` refuses a `.card`, `.card-head`, `.card-body` or `.pack` selector and a rounded rule in a `--plate*` fill outside `.plate`.
- `eslint-rules/no-hand-rolled-card.js` refuses the same four class names in markup and in DOM code.
- Text darker than `--ink-2`, the accent's reach and the size tokens are review rules, not gated.

### Hand-back

Every faceplate change is checked at 1080×810, 1180×820 and 1366×1024, with the real fonts: nothing scrolls, clips or overlaps at any of the three.
