# Fast-check: error-context properties

Owner: Ahmad (@Ahmed120515)

## Tool and purpose

Fast-check is a property-based testing library. It generates inputs, checks a
behavioral rule for each input, and shrinks a failing input to a smaller
counterexample. This check exercises the real `ErrorContext.collect` and
`ErrorContext.latest` functions using Bun's test runner. It supplements the
existing example tests for the team's error-context collector.

## Installation and local use

`packages/opencode/package.json` declares `fast-check` 4.8.0 as a pinned development
dependency. `bun.lock` records the direct dependency. The same version was already
present indirectly through Effect; no dependency upgrade was necessary.

With the repository's Bun 1.3.14 and Node.js 24:

```sh
# Repository root
bun install --frozen-lockfile

# Tests must run from their package, not the repository root.
cd packages/opencode
bun run test:properties
```

Replay the generated inputs from a previous run using the seed printed in its log:

```sh
FAST_CHECK_SEED=17313 bun run test:properties
```

The optional seed must be a signed 32-bit integer. An unset seed defaults to the
current time converted to a signed 32-bit integer, so subsequent runs explore
different cases. On failure, fast-check also reports a shrinking path and the
counterexample. Replaying the seed with the same dependency version and test code
repeats the generated sequence and shrinking.

## Customization and scope

Each of ten properties runs 500 generated cases (5,000 total on a successful run):

1. Explicit failures preserve tool, input, error, exit code, and output precedence.
2. Completed shell calls with nonzero integer exits produce failure context.
3. Pending/running calls, successful shells, and completed non-shell tools are ignored.
4. Invalid exit metadata does not imply a completed shell failure.
5. Interrupted errors are ignored.
6. Only the latest user's task and file context are used; hidden text is excluded.
7. An input file is added only when absent, preserving supplied file context.
8. The latest failure uses history up to that failure, without later user context.
9. A nonblank pasted error takes precedence over history failures.
10. Arbitrary JSON parts and histories do not cause exceptions or input mutation.

Generators bound text to 100 characters, paths to 60 characters, and message/file
lists to 12 entries to keep feedback quick. Cases include empty strings/lists,
positive and negative exit codes, malformed JSON-shaped inputs, absent output,
and hidden user text. Parameters apply to these assertions only; no global
fast-check settings or mocks are installed.

## Development process and evidence

`.github/workflows/fast-check.yml` runs the focused package script on PRs targeting
`main`, pushes to `main`, and manual runs. A failed property gives a nonzero exit,
which fails the job. `pipefail` preserves that failure while `tee` records output.
The `fast-check-evidence` artifact contains the log, including the seed and any
counterexample, and is retained for 30 days. The existing unit-test workflow also
discovers the property test through the normal package test command.

Local results and negative-control summaries are recorded in
[`fast-check-evidence.txt`](./fast-check-evidence.txt). Add a successful GitHub
Actions run using the normal dependency installation to the individual PR before
submitting it for grading.

This job joins the team's existing checks; the final group submission must still
verify all members' checks and deployment on `main` after their PRs merge. This
change does not configure branch protection or modify the deployment workflow.

## Findings and limitations

No collector defect was found in the recorded successful generated run. Two
temporary local regressions were rejected: treating exit zero as a shell failure,
and using the oldest user task instead of the latest. These were deliberate
negative controls, not defects discovered in the original code. The source was
restored before the final passing run; no collector changes are included.

No false positives were observed in the recorded run, and there were no real
findings dismissed as irrelevant. These observations are not measured false-positive
or false-negative rates. Finite generated tests can miss defects outside their
properties, data limits, seeds, or JSON-shaped input domain. They do not test model
answers, UI behavior, deployment, or OpenRouter authentication.

## Changes from the P3A plan

The planned fast-check/Bun integration for the error-context collector is retained.
Implementation choices make the plan concrete: ten bounded properties, 500 cases
each, per-run seeds with a local replay override, pinned direct dependency, and
uploaded text logs. `latest` is included alongside `collect` to check history
selection and pasted-error precedence. No application-code fix or weakened
assertion was needed to pass.

Tool documentation: <https://fast-check.dev/docs/introduction/>.
