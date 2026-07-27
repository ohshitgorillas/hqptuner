# Design system — frontend layout (binding)

All visual work conforms or flags a deviation. Never hardcode layout px — use the tokens.

**CSS is split by concern** under `hqptuner/static/css/`, none over the 500-line gate. The `<link>` order in `hqptuner/static/index.html` **is** the cascade order. Never reorder it; add a new module at the position its rules need, not at the end by default.

**Tokens (`hqptuner/static/css/tokens.css` `:root`):**
- Spacing scale `--sp-1..5` = 4/8/12/24/32. Every intra-row / inter-row gap references these.
- Widths: `--w-label` (12rem, the shared label column), `--w-num` (short numerics + knob readouts), `--w-select` (28rem), `--w-select-wide` (30rem, long strings), `--w-path`.
- `--measure` (68ch) = the single caption/description measure. `--w-app` (~1200px) = container cap.

**Typography, surfaces, corner radius and motion are tokens-only (binding).** Never write a literal `font-size`, `font-weight`, `letter-spacing`, `border-radius` or `transition` in `static/css/`, never a raw colour outside `tokens.css`, and never name an elevation shade directly. `scripts/check_css_tokens.py` fails the build on all of them (wired into `make lint-js` and pre-commit).
- **Size** — pick the token whose *role* matches the text, never by eyeballing a number: `--fs-micro` (0.72, inline hints/credits) · `--fs-caption` (0.78, notes and descriptions) · `--fs-label` (0.85) · `--fs-body` (0.9, **the default** for controls and field labels) · `--fs-head` (0.95, card-head/subhead) · `--fs-body-lg` (1) · `--fs-title` (1.1) · `--fs-brand` (1.25) · `--fs-readout` (1.5) · `--fs-glyph` (1.9, disclosure triangles). SVG text uses `--fs-svg-sm` / `--fs-svg` (px — SVG user units do not follow the root rem).
- **Weight** `--fw-normal|medium|semibold|bold`. **Tracking** `--track-tight|caps|wide`, only ever with `text-transform: uppercase`.
- **Text greys are exactly three, chosen by role:** `--fg` = content the user reads (values, control text, headings) · `--fg-2` = text that *names* things (labels, keys, column heads) · `--muted` = captions, notes, hints, units, disabled/off. A fourth shade is a review flag.
- **Surfaces are exactly four, chosen by role:** `--surface-page` = the page, and any chrome painting the page lane · `--surface-card` = a card or panel body, the frame that holds fields · `--surface-raised` = anything sitting *on* a card: card and collapsible heads, controls, chips, popovers, plots · `--surface-well` = a recessed reading surface, i.e. the log tail and the matrix paste box. A fifth shade is a review flag.
- **The raw ladder (`--bg`, `--bg-2`, `--bg-3`) is private to `tokens.css`.** A `var(--bg*)` reference in any other module fails the build. Naming a surface by its shade is how one card ends up a different colour from the card beside it — name the role and the shade follows. The `--bg-1` alias is gone; it aliased `--bg-3`, so the ladder carried two names for one colour and the lower-sounding name was the higher shade.
- **A border, an SVG `fill`/`stroke` and a `box-shadow` are surfaces too.** They were where the drift hid: ~30 sites painted an elevation shade through a property the old gate never looked at. Same four roles apply.
- **Never dim text with `opacity`.** Opacity multiplies a token instead of replacing it, which is how one role ends up with several different effective greys. Opacity is for whole-control states (disabled, off, inactive), never for shading a colour.
- **Text roles live in `typography.css`** — the one module loaded **last**, because it owns the size and colour of every text role and must win over the modules it replaced. New text takes a role class (`.t-head`, `.t-eyebrow`, `.t-label`, `.t-caption`, `.t-micro`, `.t-value`); it does not get a new rule with its own size and colour.
- **Corner radius is exactly six, chosen by role:** `--r-xs` (3px, hairline marks — range tracks, tiny badges, legend swatches) · `--r-sm` (4px, small chips and swatches) · `--r-md` (6px, **the default** — controls, inputs, fields, panels sitting on a card) · `--r-lg` (8px, things that hold other things — cards, plots, popovers) · `--r-pill` (999px) · `--r-circle` (50%). Replaced 17 free-chosen values spread 2–15px, mixing px and rem for the same corner. The gate checks *every* corner of a shorthand, so `var(--r-md) 6px` fails.
- **Motion is exactly two roles.** `var(--dur) var(--ease)` for a state change — hover, focus, disable, open/close. `var(--sweep)` (1s ease-out) for a live readout easing toward a value the poll refreshes every 2s: the VU needle and the meter fill. Duration and curve travel together in `--sweep` because splitting them invites half-uses. Never a transition on a live drag.
- Escape hatch for a value that genuinely cannot be a token: `/* token-exempt: <reason> */` on the line. The reason is required — an exemption you cannot justify in a clause is a value that belongs in `tokens.css`.
- **Not yet gated:** `gap`/`margin`/`padding` still hold ~150 off-scale values (mostly control-internal padding). Prefer `--sp-*` in new work; the sweep is outstanding.

## Rules

- **Half-track rows cap controls to the track.** `--w-select`/`--w-select-wide` are legal only in full-span rows; inside a `.pack` (or a half-width `.card-grid` card) selects/text go `width:100%; max-width:100%; min-width:0`, and grid items get `min-width:0`. The 12rem-label + 28rem-select sum overflows a half-track — the column is the cap.
- **Two-track section grid is all-or-nothing** (`.pack`): short rows (numeric / checkbox / radio / narrow select) pack two-up; long-string rows opt into full-span via `.span` (schema `span: true` — device dropdowns, log path), never via `.field.wide`.
- **Pack by relatedness, not source order** (`.pack.chain`): a sequential control chain stacks in the LEFT column, the secondary control goes to the right (e.g. filters `[1x, Nx]` left / dither|modulator right).
- **Two-column cards carry a centred rule (binding).** *Every* full-width card with two internal columns draws a 1px `var(--line)` hairline between them, and **every such rule sits on the card's centre line** so they stack vertically down the page. Three mechanisms, by shape:
  - *Fixed two-column split* (`.knob-cluster`, `.cluster-row`, `.xfc-cols`) — an explicit 1px grid track: `grid-template-columns: 1fr 1px 1fr` + a `<span class="col-rule">`.
  - *Multi-row two-track grid* (`.pack`) — one full-height `::before` on the container's centre line, so it covers however many rows the pack has.
  - *Border fallback* (`.pack.split`) — pull the border into the middle of the gap with `margin-left: calc(var(--sp-4)/-2); padding-left: calc(var(--sp-4)/2)`. Never leave a `border-left` at a column edge: it lands `gap/2` off-centre and visibly misaligns against every other rule.
  - A full-span row (`.span`) must not be struck through — it masks the rule over its own height by painting its surface (`--surface-card` inside a card, `--surface-page` on the bare page). This selector once carried a hand-maintained list of card-like containers and a container that fell off it painted page colour over a card, reading as a dark band across the row. There is only `.card` now; keep it that way.
  - **Exactly one rule per split.** A section marker that draws its own `border-left` beside the centred rule (`.cluster`, `.indent` inside a `.pack`) reads as a second divider — drop the border there and let indentation alone carry the nesting.
  - Below the 1100px breakpoint the split collapses to one column and the rule hides.
- **Card rows fill the container.** Paired cards share height via `.card-grid { align-items: stretch }`; `.card` carries `background: var(--surface-card)` (header `--surface-raised` + hairline) so a stretched card's empty area reads as surface, not a page-bg hole.
- **There is one card component, and card markup is written once (binding).** `Card` in `components/tabs/common.js` owns `.card` / `.card-head` / `.card-body`; nothing else may write them. A collapsible is not a second component — it is a `Card` handed a `collapse` handle (`{open, onToggle}`, built from an auto/override signal pair by `collapseFrom`), which turns the head into a toggle button and makes the body conditional. The two were separate once, and their surfaces drifted until an open collapsible read as a darker card than the card beside it. `eslint-rules/no-hand-rolled-card.js` fails the build on card classes written anywhere else; a card whose structure genuinely does not fit takes a file-level `eslint-disable` **with a reason**, the same escape hatch as `/* token-exempt: */`.
- **Rhythm:** control→caption gap ≈ ⅓ of the row→row gap (tight intra `--sp-1`, inter-field `--sp-4`). Captions cap at `--measure` and wrap — never truncate.
- **Container** `--w-app` ~1200px; below ~1100px viewport, sections fall back to single column (the old layout is the fallback, kept intact).
- Deliberate trailing half-cells (odd control count) are allowed; unnameable blanks are not.

## Definition of done (every tab @1280)

(a) nothing clips or overlaps; (b) each section fills both tracks or deliberately spans; (c) every card row's right edge is flush with the container; (d) all whitespace is page gutter, inter-track gutter, or caption margin — no unnameable blanks.

## Hand-back protocol for visual work (binding)

Before reporting ready, verify against FRESH screenshots at 1280 and report PASS/FAIL per acceptance criterion, with measured pixel numbers for anything measurable (card bottom edges, control widths, edge alignments — measure the DOM via headless chromium + playwright, not by eye). "Ready" with an unverified or failing criterion is a process failure regardless of how the page looks.

## Regression guard

Any new control / row / section / card slots into the token + grid system. A new one-off pixel value in layout CSS is a review flag by default.
