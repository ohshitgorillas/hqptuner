# features

a list of features and fixes the user has thought up while using HQPTuner. remove items from this list when finished.

1. sort filters by light/medium/heavy? (this is more of a wishlist item than a feature that needs implemented now)

5. The triple-handle Range slider needs a visual overhaul; it looks bad.

Can we do a [-like symbol for the min and ]-like for the max?
And maybe a down caret `v` or filled in triangle for startup volume
Startup vol is offset from its actual value/tickmark (which btw is unlabeled)
tickmarks are nearly invisible
-120 and +12 limits are jammed up against the sides of the card

9. Playing DSD content back still shows "SHAPER" at the top incorrectly as AMSDM7EC 512+fs. Confirm how the SDM>SDM pipeline works and fix the top cards.

10. pipelines is taking up a ton of DSP page space when filled in, make it collapsible

11. increase the size of teh BAUER|STRUCTURAL switch to fill the vertical space better

12. `PendingBar` uses native `prompt()` for the preset name and `confirm()` for overwrite. Unstyleable against the rest of the app, not cancellable gracefully, and blocked outright in some embedded browsers. Wants a real inline field / dialog.

13. `store/prefs.js` swallows its `localStorage` read failure in a bare `try/catch`, so a broken or unavailable store silently falls back to defaults with no signal. Benign in the browser; it also means persisted prefs always read as defaults under node, which would quietly defeat any future persistence test.

14. The built wheel contains no `hqptuner/static/` and no `data/`, so a plain `pip install hqptuner` cannot serve the frontend or read the metadata JSON. Docker only works because `WORKDIR /app` + `python -m` puts the cwd ahead of site-packages and `/app/hqptuner` shadows the installed copy. Silent failure mode: if that shadowing ever stops, the SPA mount is skipped and the frontend 404s with nothing logged. Either ship the package data or make the omission explicit.

15. `.dockerignore` root-anchors `__pycache__` and `*.pyc`, so `hqptuner/**/__pycache__` still enters the build context and gets baked into the image. Wants `**/__pycache__` and `**/*.pyc`.

16. The editable install in `.venv` reports version 0.3.1 while `pyproject.toml` says 0.6.0 — stale editable metadata. Harmless for code resolution, wrong for anything that reads the version string.
