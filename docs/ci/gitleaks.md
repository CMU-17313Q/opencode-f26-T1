# Gitleaks: secret scanning

Owner: Bel Ami Gisage Warakoze (@belamigw)

Gitleaks scans git history for hardcoded secrets (API keys, tokens, private keys).
Any finding fails the job.

## Setup

- `.github/workflows/gitleaks.yml` installs Gitleaks 8.30.1 (SHA-256 verified) and
  scans all commits reachable from `HEAD` on PRs to `main`, pushes to `main`, and
  manual runs. Output is redacted and uploaded as the `gitleaks-evidence` artifact.
- `.gitleaks.toml` extends the default rules with narrow allowlists for reviewed
  false positives.

Run locally from the repo root. Install Gitleaks with one of:

- macOS: `brew install gitleaks`
- Linux / Windows: download the v8.30.1 binary from the
  [releases page](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) and add it to your `PATH`

```sh
gitleaks git . --log-opts="--full-history HEAD" --redact --verbose
```

Or, with Docker on any OS (no install):

```sh
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --log-opts="--full-history HEAD" --redact --verbose
```

If it finds a real secret: rotate it first, then remove it from the code. Only
allowlist confirmed false positives.

## Results

- The first scan found 25 false positives, all from the upstream opencode import
  (`826ab5f`): doc placeholders, test fixtures, public client IDs, and identifiers.
  None were real secrets.
- After tuning, the scan passes (35 commits, no leaks).
- A negative control with 6 fake secrets, including 3 in allowlisted files, caught
  all 6.

Details: [`gitleaks-evidence.txt`](./gitleaks-evidence.txt).

## Changes from the design doc

- **Binary, not the GitHub Action.** `gitleaks-action` needs a license key for
  organization repos, so the workflow installs the pinned release binary.
- **Allowlists added** for the 25 upstream false positives, scoped by rule, path,
  and value.
- **Scans `HEAD`, not `--all`**, so teammates' unmerged branches don't fail this check.
- **Not yet required.** Making it a required check needs a repo admin to enable
  branch protection.
