// The two popover select widgets every narrowing facet renders through, plus the
// count chrome they share. Its own module because these are generic chrome: they
// know nothing about which facet they draw, taking their open signal, items and
// count mapper as props.
import { html } from "../../lib/dom.js";
import { toggleIn, chainCounts } from "./labels.js";

// Column head for the count chips, the popover's first row. The bare pair
// ("17/47") reads as a fraction and is not one, so the column says what its two
// numbers are: the active chain's 1x list size and its Nx list size.
const CountHead = () => html`<div class="multi-head t-label">1x / Nx</div>`;

// The count chip shown right-aligned in each popover row. A pair that zeroes out
// both stages reads `dead` — a dead-end pick, dimmed so it is visible before
// clicking.
/**
 * Renders one popover row's "1x/Nx" count chip, marked `dead` when the pick
 * would empty both stages.
 * @param {{ overrides: import("./labels.js").NarrowOverrides }} props
 */
export function CountChip({ overrides }) {
  const { one, nx } = chainCounts(overrides);
  const dead = one + nx === 0;
  return html`<span class="opt-count ${dead ? "dead" : ""}">${one}/${nx}</span>`;
}

// single-select twin of MultiSelect — same button + popover chrome so every
// facet renders as one identical control (no native <select> chrome mixed in).
// Picking a value closes the popover. Quality, phase and length use it: each
// is a facet a filter carries exactly one of, so two picks could only
// intersect to nothing. `extra` matches MultiSelect's.
/**
 * Renders a facet button and a popover of radio rows; picking a value calls
 * `onPick` and closes the popover.
 * @param {{ open: import("./popover.js").OpenSignal, name: string, label: string, value: string | number,
 *           items: import("./facet-data.js").FacetItems,
 *           onPick: (v: string | number) => void, active: boolean,
 *           count?: (v: string | number) => import("./labels.js").NarrowOverrides, extra?: unknown }} props
 */
export function SingleSelect({ open, name, label, value, items, onPick, active, count, extra }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
              ${count ? html`<${CountHead} />` : null}
              ${items.map(
                ([v, l]) => html`
                  <label>
                    <input
                      type="radio"
                      checked=${String(v) === String(value)}
                      onChange=${() => {
                        onPick(v);
                        open.value = false;
                      }}
                    />
                    <span class="opt-label">${l}</span>
                    ${count ? html`<${CountChip} overrides=${count(v)} />` : null}
                  </label>
                `,
              )}
              ${extra || null}
            </div>`
          : null
      }
    </div>
  `;
}

// a checkbox-dropdown multi-select (the shared genre/focus pattern): a button
// showing the summary label, a popover of checkboxes toggling `sig`'s array.
// `extra` is an optional element appended below the item rows, divided off —
// genre and focus use it for their AND/OR combine switch.
/**
 * Renders a facet button and a popover of checkbox rows, each toggling its
 * value in `sig`'s array; the popover stays open across picks.
 * @param {{ open: import("./popover.js").OpenSignal, name: string, label: string,
 *           items: import("./facet-data.js").FacetItems, sig: import("./labels.js").MultiSignal,
 *           extra?: unknown, active: boolean,
 *           count?: (v: string | number) => import("./labels.js").NarrowOverrides }} props
 */
export function MultiSelect({ open, name, label, items, sig, extra, active, count }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
              ${count ? html`<${CountHead} />` : null}
              ${items.map(
                ([v, l]) => html`
                  <label>
                    <input type="checkbox" checked=${sig.value.includes(v)} onChange=${() => toggleIn(sig, v)} />
                    <span class="opt-label">${l}</span>
                    ${count ? html`<${CountChip} overrides=${count(v)} />` : null}
                  </label>
                `,
              )}
              ${extra || null}
            </div>`
          : null
      }
    </div>
  `;
}
