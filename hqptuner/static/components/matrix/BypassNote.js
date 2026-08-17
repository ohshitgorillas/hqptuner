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
// TWO sentences, picked by whether the card's own feature is engaged. "These
// settings have no effect" is a complaint about settings the user is actually
// using; a user who has DAC correction switched off is not using any, and what
// they need to know is that the switch itself is waiting on the engine. The card
// knows what "engaged" means for itself and passes it as `on`; this component
// owns only the matrix half.
//
// WHERE IT GOES, and where it deliberately does not. Everything inside <matrix>
// takes it. The Pipelines card takes it unconditionally — the pipeline rows are
// the matrix, there is no separate switch to be off. The Crossfeed card reads its
// own engagement as `crossfeed_enabled` in the Bauer view and an installed
// structural block in the Structural view (store/xfeed/mode.js) — structural
// crossfeed is sixteen compiled pipeline rows and Bauer crossfeed is a
// post_process plugin, so a bypassed engine runs neither. The Matrix response
// card takes the alternate sentence below and only when its plot has something on
// it: an empty plot has no "below" that could be unapplied, so it stays silent.
// The post_process cards, DAC correction and Loudness, read their own switch:
// <post_process> nests inside <matrix> (hqplayerd-readme.txt §1.11.2) and §1.11's
// `enabled` is the matrix processing switch, so a bypassed matrix runs no plugin
// in the chain — the structure documents it, and the note states it.
//
// The Speakers card is out: <speakers> is its own element with its own `enabled`
// (readme §1.9). Level and distance trims keep working with the matrix bypassed,
// so the note there would simply be wrong. The Headphone Auto EQ card is out too:
// it is an importer, and what it imports lands in the Pipelines card, which says
// the sentence already.
//
// The note informs; the graying is the schema's (store/schema.js matrixBypassed,
// on every post_process field). The pipeline TABLE stays editable — a user may
// build a profile against a bypassed engine and engage it afterwards.
import { html } from "../../lib/dom.js";
import { effective } from "../../store/resolve.js";
import { MATRIX_BYPASS_REASON } from "../../store/schema.js";
import { truthy } from "../../lib/coerce.js";

// What a card says when its own feature is switched off: nothing the user has set
// is being ignored, so the note points at the switch instead of at the settings.
const MATRIX_BYPASS_ENGAGE = "Matrix engine is bypassed. Engage it to use this feature.";

// `text` overrides both sentences for a card whose grievance is neither: the
// Matrix response card is showing a CURVE rather than controls, so it says what
// is not being applied instead of what has no effect.
/**
 * Renders the "matrix engine is bypassed" note on a card, or nothing when the
 * effective `matrix_enabled` is truthy.
 *
 * @param {{ on: boolean, text?: string, advisory?: boolean }} props `on` is
 *   whether this card's own feature is engaged, which picks the sentence;
 *   `text` overrides both; `advisory` forces the muted italic tone
 */
export function BypassNote({ on, text, advisory }) {
  if (truthy(effective("matrix_enabled"))) return null;
  const said = text || (on ? MATRIX_BYPASS_REASON : MATRIX_BYPASS_ENGAGE);
  // The engage sentence is advisory in the same voice as a schema `adviseWhen`
  // note — it names the state the feature needs, it does not report settings
  // being ignored — so it takes the muted italic caption rather than amber. The
  // Pipelines card takes that tone too (`advisory`): it has no switch of its
  // own, so its note is the same "engage the engine" advice in other words.
  const cls = advisory || said === MATRIX_BYPASS_ENGAGE ? "mtx-bypass-advice" : "mtx-bypass-note";
  return html`<div class=${cls}>${said}</div>`;
}
