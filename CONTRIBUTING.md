# Contributing to HQPTuner

## Bug reports

To report a bug, please reach out with the following information:

* HQPTuner version (System → About) and hqplayerd version (top bar, next to the daemon name)
* What you changed, what you expected, what happened
* Browser and OS, for anything visual
* Relevant lines from HQPTuner's log (System tab) — the failure detail that doesn't fit on screen goes there

## Setup

Run:

```sh
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm install
.venv/bin/pre-commit install
```

CI runs Python 3.14. `requires-python` still admits 3.12+, but 3.14 is what is actually exercised.

## Before you open a PR

`make check` must be green. It is the same set the pre-commit hooks run, plus the JS test suite. See the Development section of `README.md` for what each target covers.

I am extremely strict about what tests make it into the codebase, so please review `docs/testing.md` for the binding testing policy.

Every user-visible change lands with a `CHANGELOG.md` entry under `[Unreleased]`, in the same commit as the change. Write it for the person hitting the bug, not for the person who fixed it: what went wrong from the user's side, what it does now.

`dev` is where work lands. `beta` publishes `ghcr.io/ohshitgorillas/hqptuner:beta` for testers, `main` publishes `:latest`. Open PRs against `dev`.

