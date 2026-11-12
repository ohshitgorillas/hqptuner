# Roadmap: HQPTuner

## Overview

Milestone v2.0.0-dev.2 is a work-in-progress cycle on `v2`: the six deferred defects (BUG-01 to BUG-06), the triaged untested behaviors in `todo.txt` (TEST-01), entries for the new "aclean" filters (FILT-01), and no trace on the visualizer effects other than the spectrum (SPEC-02). Each requirement is its own phase, in the order the owner gave them; no phase depends on another.

## Phases

- [x] **Phase 1: Snapshots stay on their stations** - saving a snapshot to one station no longer erases it from another
- [x] **Phase 2: Modulators fit the output rate** - the picker offers only modulators the running output rate supports, and a live apply that stops playback says so
- [x] **Phase 3: HF filter lamp follows the content** - the HF filter lamp lights only for content the filter acts on
- [x] **Phase 4: Dimmed while HQPlayer is away** - the app is dimmed while HQPlayer is unavailable or disconnected
- [ ] **Phase 5: Untested behaviors covered** - every behavior on `todo.txt`'s triaged untested list is covered by a test or struck
- [ ] **Phase 6: aclean filter entries** - each new "aclean" filter has an entry in the shipped filter data
- [ ] **Phase 7: No trace on the other visualizer effects** - the trace shows on the spectrum only, not on Borealis or any other effect
- [ ] **Phase 8: Packaged builds open in the browser** - "Open HQPTuner" in a packaged build opens the app in the browser

## Phase Details

### Phase 1: Snapshots stay on their stations

**Goal:** A user saving a snapshot to one station keeps every snapshot on every other station.

**Depends on:** Nothing

**Requirements:** BUG-01

**Success Criteria:**

1. After a snapshot is saved to one station, every snapshot another station held before the save is still on that station.
2. The saved snapshot is on the station it was saved to.

### Phase 2: Modulators fit the output rate

**Goal:** The modulator picker offers only modulators the running output rate supports, and a live apply that makes playback stop reports the stop instead of ok.

**Depends on:** Nothing

**Requirements:** BUG-02

**Success Criteria:**

1. A modulator whose minimum rate in the engine's shapers enumeration is above the running output rate cannot be picked (e.g. AHM7EC8B, which needs DSD1024 or above, while running DSD512).
2. A modulator the running output rate supports can still be picked and applied.
3. A live apply after which playback has stopped reports the stop to the user, not ok.

### Phase 3: HF filter lamp follows the content

**Goal:** The HF filter lamp is lit only while the playing content is content the selected HF filter acts on.

**Depends on:** Nothing

**Requirements:** BUG-03

**Success Criteria:**

1. The lamp stays dark on 1x content, which no HF filter acts on.
2. The lamp stays dark for a filter on content below the rates it acts on (e.g. the 50k filter on 2x content, the 2x-8x filter on 2x content).
3. The lamp lights for a filter on content it acts on.

### Phase 4: Dimmed while HQPlayer is away

**Goal:** The app is dimmed while HQPlayer is unavailable or disconnected, and undimmed once it is back.

**Depends on:** Nothing

**Requirements:** BUG-05

**Success Criteria:**

1. While HQPlayer is unavailable or disconnected, the app is dimmed.
2. Once HQPlayer is reachable again, the app is no longer dimmed.
3. Every user action still proceeds while the app is dimmed.

### Phase 5: Untested behaviors covered

**Goal:** Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list.

**Depends on:** Nothing

**Requirements:** TEST-01

**Success Criteria:**

1. Each behavior on the list is either covered by a test that fails when the behavior breaks, or struck from the list with the owner's say-so.
2. Each new test shows a red run against a broken version of the behavior it covers.
3. No existing assertion is edited to pass.
4. `scripts/gate.sh make check` prints `exit=0`.

### Phase 6: aclean filter entries

**Goal:** The shipped filter data has an entry for each new "aclean" filter, with an empty description and no simplified name.

**Depends on:** Nothing

**Requirements:** FILT-01

**Success Criteria:**

1. Every "aclean" filter the running engine enumerates has an entry in the shipped filter data, joined by name.
2. Each of those entries has an empty description and no simplified name.

### Phase 7: No trace on the other visualizer effects

**Goal:** The trace is drawn on the spectrum only, and on none of the other visualizer effects, such as Borealis.

**Depends on:** Nothing

**Requirements:** SPEC-02

**Success Criteria:**

1. Borealis and every other visualizer effect except the spectrum draw no trace.
2. The spectrum still draws its trace.

### Phase 8: Packaged builds open in the browser

**Goal:** Clicking "Open HQPTuner" in a packaged build opens the app in the user's browser, not in a window of its own.

**Depends on:** Nothing

**Requirements:** BUG-06

**Success Criteria:**

1. In each packaged build that offers "Open HQPTuner", clicking it opens the app in the default browser.
2. No packaged build opens the app in a window of its own.
