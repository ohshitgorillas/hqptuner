# Gate notes

Commands that metered against the change budget but are read-only, for later review of `.claude/hooks/free_bash.py`.

## 2026-08-03

Running the JS test suite directly is metered, while the make target that runs the identical command is free:

```
node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-metrics-side.test.js
node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/
node --import $WT/tests/js/support/vendor-resolve.js --test $WT/tests/js/eqlab/eqlab-plot.test.js
```

`make test-js` is free and expands to exactly the first form with a wider glob (`Makefile:49`). Running one file, or a file inside a worktree, is the narrower operation and the only way to test a single file — `make test-js` has no file argument.

Also metered, read-only file comparison:

```
for f in <paths>; do diff -q "$f" ".claude/worktrees/wheel-guard/$f"; done
diff -u .claude/worktrees/wheel-guard/hqptuner/static/lib/dom.js hqptuner/static/lib/dom.js
```

`diff` reads two paths and writes nothing. `grep`, `cat` and `sed -n` over the same files are free; `diff` is the correct tool for the comparison and costs a budget slot.

Uncertain which of the above the hook actually charged — the trip reported a count, not a list. Worth having the hook name the metered stage.
