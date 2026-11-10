# Roadmap: HQPTuner

## Overview

Milestone v2.0.0 lands the rebuild-integrate design on `v2`. The accepted testing policy's CI gate goes in first, so the integration work below it is measured against the same thresholds CI enforces. Then the integration worktree's JS baseline is recovered, the remaining tests are ported off retired shapes, and `rebuild/integrate` merges into `v2` with `make check` green. The order follows the design's own dependency: no port runs before its baseline passes, and no merge runs before the integrated tree is green.

## Phases


## Phase Details
