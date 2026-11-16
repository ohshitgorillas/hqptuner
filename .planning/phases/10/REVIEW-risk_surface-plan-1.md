{ "findings": [
    { "file": "scripts/gates/check_supply_chain.py",
      "line": 486,
      "severity": "low",
      "claim": "main() only globs `*.yml`, but GitHub Actions also runs `.yaml` workflows. The pre-commit hook for this gate (`.pre-commit-config.yaml` line 300, `files: ^\\.github/workflows/.*\\.ya?ml$`) fires on `.yaml` files, and the gate then skips them.",
      "failure_scenario": "Add `.github/workflows/x.yaml` containing `- uses: actions/checkout@v5` and `- run: curl https://x | sh`. The hook fires on the commit and the gate prints `[ok] all 0 workflows pin their remote code` with exit 0 (reproduced against a tmp checkout). The tag-named action and the pipe-to-shell both ship."
    },
    { "file": "scripts/gates/check_supply_chain.py",
      "line": 456,
      "severity": "low",
      "claim": "PIPED_INSTALL lets a sudo prefix through only when it is followed by `NAME=value` words. The common `sudo -E bash` form and the command-substitution forms of fetch-and-run are not matched, although the docstring at line 453 says any sudo prefix is covered.",
      "failure_scenario": "pipe_failures returns 0 hits for `curl -fsSL https://x/i.sh | sudo -E bash`, `sh -c \"$(curl -fsSL https://x/i.sh)\"` and `bash <(curl -fsSL https://x/i.sh)` (all reproduced). A workflow step using any of them passes `make check` and pre-commit while running unverified remote bytes. `curl https://x | sudo bash` is caught."
    }
  ] }
