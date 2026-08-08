// Behavioural suite for the Matrix Profile card's save consequence line — the
// sentence telling the user that saving a matrix profile does not survive until
// the engine restarts:
//
//     Restart the engine (Apply) to finalize the save.
//
// Why the line exists, and why it names Apply: a profile save is a STAGED config
// edit on `matrix_profile_save` over the http lane, because hqplayerd's own
// /matrix/save registers the profile in memory only and the config it writes back
// omits the `<matrix_profile>` element, so a profile saved that way dies at the
// next daemon start (hqplayerd-readme.txt §1.12, docs/matrix-spec.md round 5). A
// staged http-lane edit reaches the daemon only through POST /api/config/apply,
// whose persistent lane restarts the daemon — and there is no separate restart
// control in the UI, so Apply IS the restart.
//
// The line describes a PENDING save, not a standing property of the card. It
// appears once a save is staged and goes away when the staged set is discarded —
// left up unconditionally it describes nothing, which is what it did before this
// suite's contract was corrected.
//
// It is a consequence of the user's action, not a manual description of a
// control, so within the staged state it is NOT gated on the
// description-visibility preference: it renders with `showDescriptions` off and
// with it on.
//
// It is also specific to a profile save. Any other staged edit — an ordinary
// setting the user changed on some other tab — leaves the card silent; the line
// speaks for the save, not for the pending set.
//
// Shape, over the axes that matter — is a save staged, is some OTHER edit staged,
// is the card populated, and is the preference on:
//
//   * staged save, populated card, preference OFF and ON — the preference does
//     not gate the line.
//   * NOT staged, populated card, preference OFF and ON — and the preference does
//     not conjure it either. Both polarities are covered in both preference
//     states, because a condition of the form `preference || pending` reads as
//     correct against staged-only-OFF plus unstaged-only-... and warns a user
//     about a save they never made.
//   * staged and not-staged over the SAME first-run card (no saved profiles, no
//     `matrix_pipelines` rows) — a user who has never saved gets the warning the
//     moment they stage their first one, and not before.
//   * an unrelated staged edit over the populated card, paired with the staged
//     save on that same fixture — the line follows the save, not the buffer.
//   * staged, then discarded — the line comes back off.
//
// Every negative is paired with a positive over the SAME fixture, and that
// pairing — not the empty-render sentinel in `says` — is what stops a negative
// passing on a card that rendered nothing: the sentinel only fires on a literally
// empty render, which a card with any wrapper never produces, so it is a backstop
// and nothing more.
//
// Left out deliberately as restatement: staged-and-preference-on over the
// first-run card, and discard over the first-run card. Both need two independent
// claims to break at once before they would fail, and each is already covered by
// a case that isolates one of them.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at the
// wire. Each case renders the exported `ProfileCard` driven by the exported store
// signals (`config`, `matrixConfig`, `showDescriptions`) and by the exported
// `stageProfileSave` / `discardAll` over the staging server on the real REST paths
// (tests/js/support/wire.js). Nothing is stubbed and no module private is touched
// — in particular the staged state is set up and torn down through the store's own
// public staging path and read back through the rendered sentence, never off
// `profileSavePending`, which is a seam and not the behaviour.
//
// PLACEMENT is deliberately not asserted: which element carries the line and
// which class it wears are free to change, so the cases ask only whether the
// card's rendered output carries the sentence. The lookup goes through `says`,
// which answers a STRING rather than a boolean when the card rendered nothing at
// all — so a case cannot pass by looking at nothing.
//
// NOT covered: clicking Save. SSR fires no event handlers, so the click path has
// no coverage here and is not faked.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrix-profile-save-note.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { ProfileCard } from "../../../hqptuner/static/components/MatrixProfileCard.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { stageProfileSave } from "../../../hqptuner/static/store/profiles.js";
import { stagingWire } from "../support/wire.js";

const NOTE = "Restart the engine (Apply) to finalize the save.";

/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// A stereo passthrough pair, so the populated fixture has an active profile's
// rows behind it, and one saved profile so the picker has something to list.
const ROWS = [ROW({}), ROW({ source: "1", mixdown: "1" })];

// The two card states. `populated` is a card that has been saved to before;
// `empty` is the first-run card — nothing the daemon read, nothing in the config,
// no rows.
const POPULATED = {
  profiles: ["Night"],
  saved: { Night: { rows: ROWS, post: {} } },
  rows: ROWS,
};
/** @type {{ profiles: string[], saved: Record<string, unknown>, rows: PipelineRow[] }} */
const EMPTY = { profiles: [], saved: {}, rows: [] };

// Full reset every time — every one of these signals outlives a test, and the
// pending buffer is private so it is cleared through discardAll() over the wire.
/**
 * @param {{
 *   descriptions: boolean,
 *   card: { profiles: string[], saved: Record<string, unknown>, rows: PipelineRow[] },
 * }} fixture
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function reset({ descriptions, card: state }) {
  const w = stagingWire();
  showDescriptions.value = descriptions;
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: state.profiles,
    live_active: "[Default]",
    file_profiles: state.saved,
  };
  config.value = {
    fields: [],
    file: state.rows.length ? { matrix_pipelines: JSON.stringify(state.rows) } : {},
    active: "",
    profiles: null,
  };
  await discardAll();
  return w;
}

// SSR escapes entities; the contract is the text a user reads, not its encoding.
/** @param {string} out */
const decode = (out) =>
  out
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const card = () => decode(render(html`<${ProfileCard} />`));

// Whether the rendered card carries a given sentence. The empty-render sentinel
// is a backstop for a card that returns nothing at all, not the thing keeping the
// negatives honest — see the header: each negative is paired with a positive on
// the same fixture, and that pairing is what proves the negative is looking at a
// rendered card.
/**
 * @param {string} out
 * @param {string} text
 * @returns {boolean | string}
 */
const says = (out, text) => (out.trim() === "" ? "the profile card rendered nothing at all" : out.includes(text));

// Stage a profile save the way the card's own Save action does — over the staging
// wire on the real REST path. The rows are handed to the call, so this works the
// same on a card whose config carries no pipelines: what is staged is what the
// user asked to save, not what the daemon is running.
const stageSave = () => stageProfileSave("Night", ROWS, []);

// ============================================================================
// a staged save puts the line up, whatever the preference says
// ============================================================================

test("test_a_staged_profile_save_states_it_needs_apply_when_descriptions_are_hidden", async () => {
  await reset({ descriptions: false, card: POPULATED });
  await stageSave();
  assert.equal(says(card(), NOTE), true);
});

test("test_a_staged_profile_save_states_it_needs_apply_when_descriptions_are_shown", async () => {
  await reset({ descriptions: true, card: POPULATED });
  await stageSave();
  assert.equal(says(card(), NOTE), true);
});

// ============================================================================
// nothing staged, nothing said
// ============================================================================
// The line describes a pending save. With no save pending it describes nothing,
// so it must not be on screen.

test("test_a_profile_card_with_nothing_staged_does_not_state_a_save_needs_apply", async () => {
  await reset({ descriptions: false, card: POPULATED });
  assert.equal(says(card(), NOTE), false);
});

// The cell that catches `showDescriptions.value || profileSavePending.value`:
// turning descriptions on is not a save, so it must not warn about one.

test("test_showing_descriptions_does_not_by_itself_state_a_save_needs_apply", async () => {
  await reset({ descriptions: true, card: POPULATED });
  assert.equal(says(card(), NOTE), false);
});

// The first-run card: no profile the daemon read, none in the config, no rows.
// This pair shares one fixture, so the negative cannot be passing merely because
// an empty card renders nothing — the positive proves the same card says it once
// a save is staged, and `says` answers a string either way if nothing rendered.

test("test_a_first_run_profile_card_says_nothing_about_apply_before_a_save_is_staged", async () => {
  await reset({ descriptions: false, card: EMPTY });
  assert.equal(says(card(), NOTE), false);
});

test("test_a_first_run_profile_card_states_a_staged_save_needs_apply", async () => {
  await reset({ descriptions: false, card: EMPTY });
  await stageSave();
  assert.equal(says(card(), NOTE), true);
});

// ============================================================================
// the line follows the save, not the staged set
// ============================================================================
// An ordinary setting staged from some other tab is still a pending edit, and
// Apply still restarts the daemon to land it — but it is not a profile save, and
// the sentence is about the save. `volume_max` is that ordinary key: nothing to
// do with the matrix, let alone with a profile.
//
// The negative carries the wire's own evidence that the edit really is staged, so
// it cannot pass because `edit()` quietly did nothing; the positive underneath it
// runs the same fixture and proves the card does say the sentence when the staged
// thing IS a save.

test("test_an_unrelated_staged_edit_does_not_state_a_profile_save_needs_apply", async () => {
  const w = await reset({ descriptions: false, card: POPULATED });
  await edit("volume_max", "-10");
  assert.ok(
    Object.keys(w.staged.live).length + Object.keys(w.staged.http).length > 0 && says(card(), NOTE) === false,
    `staged buffer ${JSON.stringify(w.staged)}, card says the save line: ${says(card(), NOTE)}`,
  );
});

test("test_a_staged_save_alongside_an_unrelated_edit_still_states_it_needs_apply", async () => {
  await reset({ descriptions: false, card: POPULATED });
  await edit("volume_max", "-10");
  await stageSave();
  assert.equal(says(card(), NOTE), true);
});

// ============================================================================
// discarding takes the line back off
// ============================================================================
// The case the user hit: staged, then Discard, and the line stayed up describing
// a save that no longer existed.

test("test_discarding_the_staged_set_takes_the_save_line_off_the_profile_card", async () => {
  await reset({ descriptions: false, card: POPULATED });
  await stageSave();
  await discardAll();
  assert.equal(says(card(), NOTE), false);
});
