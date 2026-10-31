# Bun Audit dependency vulnerability check

Owner: Abdulaziz Al Kubaisi (@akkubais)

Bun Audit checks every package in the repository's `bun.lock` against the npm
advisory service. This adds dependency vulnerability checking to the existing
tests, type checking, and import-cycle checking.

## Installation and local use

The workflow installs Bun 1.3.14, matching `package.json`, through the pinned
`oven-sh/setup-bun` action. Bun includes the audit command, so no extra npm
dependency or full workspace installation is needed.

From the repository root, with Bun 1.3.14:

```sh
bun run script/ci/bun-audit.ts
```

The wrapper runs `bun audit --json`, reads the lockfile without changing
dependencies, and compares high/critical findings with the approved baseline.
It covers development and production packages across the workspaces. It does
not run `bun audit fix`.

## Pipeline integration

`.github/workflows/bun-audit.yml` runs on pull requests targeting `main`, pushes
to `main`, and manual dispatch. It first tests the policy and then runs the live
audit. The gate fails for high or critical findings outside the approved
baseline, changed package versions, severity increases, expired baseline
entries, malformed responses, or advisory-service errors. `pipefail` preserves
the gate's exit status while `tee` saves the log. The JSON report includes
lower-severity findings as well.

The `bun-audit-evidence` artifact contains the full report, stderr, policy log,
and comparison summary for 30 days,
including when the audit fails. Checkout and artifact actions are pinned by
commit, permissions are limited to reading repository contents, and the job has
a five-minute timeout.

The team deployment currently runs in a separate workflow. This change does not
make that workflow wait for this job or configure branch protection. Those
settings require coordination with the deployment owner and repository admin.

## Findings and evidence

The local run used Bun 1.3.14 on the unchanged team lockfile at commit
`bed3fc488969c381b8676e402af3151098256c8e` on October 31, 2026. The npm advisory
service returned a valid report and the command exited with status 1 because
high and critical findings were present.

After the user approved a documented baseline, the real Bun 1.3.14 policy run
exited 0: 175 inherited high/critical entries matched exactly, with zero
unexpected or obsolete entries. All nine focused policy tests passed, including
new findings, severity escalation, changed versions, expiry, removed findings,
malformed/error responses, and mismatched process statuses. These tests exercise
the actual comparison function without mocking the audit command.

The recorded outputs are [`bun-audit-evidence.txt`](./bun-audit-evidence.txt)
and [`bun-audit-tests.txt`](./bun-audit-tests.txt). The successful GitHub Actions
run is linked in the individual PR.

The report contains 68 affected package names and 432 advisory entries: 9
critical, 166 high, 205 moderate, and 52 low. Entries can refer to the same
advisory for different affected versions, so these are not counts of unique
vulnerabilities. The complete output is in
[`bun-audit-results.json`](./bun-audit-results.json).

Critical entries include Storybook, Astro, fast-xml-parser, proxy-addr, seroval,
and tar. An advisory match does not establish that an application route is
exploitable; package use and advisory conditions still need review. No finding
has been dismissed as a false positive or automatically fixed.

False-positive and false-negative rates have not been measured. The scanner
matches dependency versions to published advisories; it does not determine
whether vulnerable code is reachable in our application. The full lockfile also
includes development tools and other workspaces, so maintainers must review
their exposure rather than assuming every finding affects the deployed UI.
No true positive has been excluded simply because it is outside that UI.
Unpublished vulnerabilities, incomplete advisory data, and application-code
security defects can be missed. A future passing scan would therefore mean no
qualifying known advisory match, not proof that the application is secure.

## Temporary baseline policy

`.github/bun-audit-baseline.json` records the inherited high/critical findings.
Each entry matches the exact package, advisory ID and URL, vulnerable range,
severity, and sorted resolved package versions from `bun.lock`. A version
change therefore requires another review even if the advisory ID stays the
same. New low/moderate entries remain visible without blocking. Removed
findings pass and are counted as obsolete baseline entries to remove.

The shared owner, reason, source commit, and expiry apply to every listed entry.
Abdulaziz (@akkubais) approved this temporary rollout baseline on October 31.
The entries remain unresolved risks, not false positives or proof of safety.
They expire at 00:00 UTC on November 14, 2026, when the gate fails until the
remaining findings are remediated or explicitly reviewed again. Do not reset the
baseline automatically or silently extend the expiry.
Changes to the baseline need explicit review in a pull request, including the
reason for accepting each new finding or extending a deadline.

A green job means no high/critical finding outside this temporary baseline.
It does not mean zero vulnerabilities. Instructor acceptance of this rollout
policy is separate from the technical result.

## Changes from the P3A design

The chosen tool, repository-wide scope, PR/main triggers, and separate job follow
the design. This implementation pins Bun 1.3.14 and retains all severity levels
in JSON evidence. It uses the built-in audit command instead of installing
another package. Actual execution exposed inherited findings, so the user
approved a temporary baseline and a gate for new high/critical findings instead
of a blanket vulnerability-free threshold. The baseline has exact entries and
an expiry. Requiring this check and gating deployment remain pending the team's
coordination rather than being claimed as already configured.

Maintenance means reviewing new advisories, updating affected dependencies with
tests, and reviewing Bun upgrades alongside the repository's runtime pin. Any
future exception must record its advisory, owner, reason, and expiry date.

Tool documentation: <https://bun.sh/docs/pm/cli/audit>.
