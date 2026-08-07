// A sequential control chain in a two-track pack: the leading PAIR stacks in
// the left track, everything after it in the right, each track its own stack.
// Explicit markup because no CSS mechanism does this reliably: grid rows share
// height (slack under the shorter field), and multicol needs a forced column
// break that Firefox has never implemented (Bugzilla 549114) — it balances
// instead, so the split point drifted with content height.
import { toChildArray } from "preact";
import { html } from "../lib/dom.js";

/**
 * Renders its children as a two-track pack — the first two in the left column, the rest in the right.
 *
 * @param {{ children?: unknown }} props the chain's controls, in sequence
 */
export function ChainPack({ children }) {
  const kids = toChildArray(children);
  return html`
    <div class="pack chain">
      <div class="chain-col">${kids.slice(0, 2)}</div>
      <div class="chain-col">${kids.slice(2)}</div>
    </div>
  `;
}
