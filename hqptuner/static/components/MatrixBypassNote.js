// "Matrix engine is bypassed" — the note that says the pipelines you are
// editing are not in the signal path.
//
// The Matrix tab let you author a whole EQ profile, stage it, apply it and hear
// nothing, because `matrix_enabled` was BYPASS and no surface said so. Only the
// signal-path diagram on another tab ever read that flag.
//
// It reads the EFFECTIVE value, not the running one: staging ENGAGE in the
// Matrix card clears the note immediately, without an Apply, the same way every
// other derived surface on the tab follows staged edits.
//
// WHERE IT GOES, and where it deliberately does not. Everything inside <matrix>
// takes it. The pipeline surfaces: the Pipelines card, the Headphone Auto EQ
// card, the Crossfeed card — structural crossfeed is sixteen compiled pipeline
// rows (store/xfmode.js) and Bauer crossfeed is a post_process plugin, so a
// bypassed engine runs neither — and the Matrix response card, which takes the
// alternate sentence below and only when its plot has something on it: an empty
// plot has no "below" that could be unapplied, so it stays silent. The
// post_process cards: DAC correction and Loudness. <post_process> nests inside
// <matrix> (hqplayerd-readme.txt §1.11.2) and §1.11's `enabled` is the matrix
// processing switch, so a bypassed matrix runs no plugin in the chain — the
// structure documents it, and the note states it.
//
// The Speakers card is out: <speakers> is its own element with its own `enabled`
// (readme §1.9). Level and distance trims keep working with the matrix bypassed,
// so the note there would simply be wrong.
//
// The note informs; the graying is the schema's (store/schema.js matrixBypassed,
// on every post_process field). The pipeline TABLE stays editable — a user may
// build a profile against a bypassed engine and engage it afterwards.
import { html } from "../lib/dom.js";
import { effective } from "../store/resolve.js";
import { MATRIX_BYPASS_REASON } from "../store/schema.js";
import { truthy } from "../lib/coerce.js";

// `text` overrides the sentence for a card whose grievance is not "these
// settings": the Matrix response card is showing a CURVE rather than controls,
// so it says what is not being applied instead of what has no effect.
/**
 * Renders the "matrix engine is bypassed" note on a card, or nothing when the
 * effective `matrix_enabled` is truthy.
 *
 * @param {{ text?: string }} props an override for the default sentence
 */
export function BypassNote({ text }) {
  if (truthy(effective("matrix_enabled"))) return null;
  return html`<div class="mtx-bypass-note">${text || MATRIX_BYPASS_REASON}</div>`;
}
