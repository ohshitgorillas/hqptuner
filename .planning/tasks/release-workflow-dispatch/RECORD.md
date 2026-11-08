# Task: release-workflow-dispatch

## What shipped

- release.yml gains a workflow_dispatch trigger so the smoke and lifecycle jobs can run on a dev commit that touches no packaging path.

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 7097145f687d4f8a153259571cd904e567a1b5f8 | ci: the release jobs can be run by hand on any branch |

## Files

### Task 1: release-workflow-dispatch

- **Files:** .github/workflows/release.yml
