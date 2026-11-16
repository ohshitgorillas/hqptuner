{
  "findings": [
    {
      "file": ".github/workflows/release.yml",
      "line": 649,
      "severity": "medium",
      "claim": "Nothing in the pipeline checks dist/SHA256SUMS.asc against the committed public key packaging/keys/hqptuner-release.asc. The README tells users to verify against that key, and check_release_signatures.py only tests that a `gpg --detach-sign` line exists in the workflow text.",
      "failure_scenario": "Say the RELEASE_GPG_PRIVATE_KEY secret in the `signing` environment is rotated, or replaced with a key that does not match packaging/keys/hqptuner-release.asc. The checksums job at line 583 still signs, `sha256sum --check --strict` and `diff` in publish still pass, the gate still prints [ok], and the release ships. Every user who runs the README's `gpg --verify SHA256SUMS.asc SHA256SUMS` then gets a bad or unknown-key signature. publish already checks out the repo, so it could import the committed key and run `gpg --verify` before `gh release create`; it does not, so this goes undetected. The deb and rpm signatures have the same unchecked dependency on the secret matching the committed key (no rpm --checksig or debsig step in release.yml)."
    }
  ]
}