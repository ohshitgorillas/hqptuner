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
// WHERE IT GOES, and where it deliberately does not. Four surfaces are matrix
// pipelines and take it: the Pipelines card, the Headphone Auto EQ card, the
// Crossfeed card IN STRUCTURAL VIEW ONLY — structural crossfeed is sixteen
// compiled pipeline rows (lib/xfmode.js), so a bypassed engine leaves it doing
// nothing — and the Matrix response card, which takes the alternate sentence
// below and only when its plot has something on it: an empty plot has no
// "below" that could be unapplied, so it stays silent.
//
// The Bauer view does not take it, and neither do the DAC correction and
// Loudness cards. Those are HQPlayer's own post_process plugins, and
// hqplayerd-readme.txt §1.11.2 files post_process under <matrix> without saying
// whether the element's `enabled` attribute reaches it. Undocumented is not the
// same as false, and "these settings have no effect" is a claim, so those cards
// stay silent rather than assert something we cannot support.
//
// The Speakers card is out for a stronger reason: <speakers> is its own element
// with its own `enabled` (readme §1.9). Level and distance trims keep working
// with the matrix bypassed, so the note there would simply be wrong.
//
// It informs and nothing more. Nothing on the tab grays, nothing disables — the
// user is allowed to build a profile against a bypassed engine and engage it
// afterwards, and HQPTuner never blocks a user action.
import { html } from "../lib/dom.js";
import { effective } from "../store/resolve.js";
import { truthy } from "../lib/coerce.js";

// `text` overrides the sentence for a card whose grievance is not "these
// settings": the Matrix response card is showing a CURVE rather than controls,
// so it says what is not being applied instead of what has no effect.
export function BypassNote({ text }) {
  if (truthy(effective("matrix_enabled"))) return null;
  return html`<div class="mtx-bypass-note">${text || "Matrix engine is bypassed. These settings have no effect."}</div>`;
}
