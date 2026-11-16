# Traceability: Abdulaziz Al Kubaisi (akkubais)

**Target feature:** OpenCode testing-strategy builder. Main files: `packages/opencode/src/session/testing-strategy.ts` and `packages/opencode/src/tool/testing-strategy.ts`.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | O-2, C-2, S-2: results require a run. | Separate recorded results from suggested tests. | For an empty-input fix with no recorded runs, Tests run says no evidence was provided and contains no pass/fail claim. The empty-input check appears only under Recommended tests (not yet run). | No | No usable run evidence means no reported pass or failure (invariant). | [Property file](../packages/opencode/test/session/testing-strategy.property.test.ts), test starting `R1:` |
| R2 | C-1, C-6: exact test and command. S-1: code location. | Include the test name, location, and command in a reproduction step when provided. | Given “empty input” at src/parser.ts:12 and bun test test/parser.test.ts, show all three in the reproduction step. | No | Reproduction preserves the supplied test, location and command (invariant). | [Property file](../packages/opencode/test/session/testing-strategy.property.test.ts), test starting `R2:` |
| R3 | O-3, C-3: return to A after log removal. | Remove the failure result and its reproduction step when the log and error are removed. | Generate A without failure context or recorded runs. Add a failing log and run record to get B. Remove that log, error, and run record. Regenerating equals A, retaining normal and edge recommendations. | No | Adding then removing failure evidence restores the original plan (round-trip). | [Property file](../packages/opencode/test/session/testing-strategy.property.test.ts), test starting `R3:` |
| R4 | O-4: keep normal input. C-4: keep empty input and add duplicates. | Recommend normal and empty-input checks in both plans, plus duplicate cases for a duplicate-removal fix. | For a parser accepting empty input and removing duplicates, the plan lists input/expected-output pairs: a,b => ["a","b"], empty string => [], a,a,b => ["a","b"], and a,a => ["a"]. These are recommendations, not run results. | No | Not selected for P4B. | Not covered by these properties. |
| R5 | O-5, C-5, S-6: check the log against the fix and rerun the input. | Mark the original failing case as verified only with a passing run on the fixed revision. | For fix revision B, a recorded empty-input pass at B may verify that case. A pass at A, skipped or missing case at B, or failure at B must not mark it verified. | No | Not selected for P4B. | Not covered by these properties. |
| R6 | O-6, C-6: show run provenance and distinguish statuses. | Show each result’s revision, time, status, rerun command, and linked bug or requirement when supplied. | Given passed, failed, and skipped records, all three keep their own status and display the supplied revision, time, command, and link. | No | Not selected for P4B. | Not covered by these properties. |
| R7 | S-3: show the error location and explain why. | Identify a known error location and explain why the suggested check matters. | Given a failure at src/parser.ts:12 and a specification that empty input returns [], the plan shows that location and explains that the suggested check tests this behavior without the original error. | No | Relocating an error preserves the behavior being checked (metamorphic). | [Property file](../packages/opencode/test/session/testing-strategy.property.test.ts), test starting `R7:` |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R7.

## Requirement changes

I kept all seven P4A requirements because each can be built and checked using supplied context and run records. R3 follows C-3 and O-3: removing the evidence removes the reported failure; S-4 did not clarify a separate source that would keep that evidence available.

## Properties and generators

I tested R1, R2, R3 and R7 using three kinds: invariant, round-trip and metamorphic. R4, R5 and R6 remain requirements for later work; these properties do not claim they are implemented.

- R1 generates missing records and records with blank or whitespace-only names or evidence. It checks the Tests run section separately from the recommendations.
- R2 varies the test name, file and line, and command independently. They come from `executed[].name`, `context.files[].path`, and `context.input.command`. It checks that all three appear in the reproduction step itself.
- R3 adds a failing log and run, then removes the error, log and run. It checks that the output returns to the original plan and keeps the normal and edge checks.
- R7 moves the same error to another file and line. Only the location should change; the explanation must still describe the expected empty-input behavior, including `[]`, without the original error.

Each property runs 200 cases with seed 17313. The generators include the P4A examples, empty evidence, whitespace, and source lines from 1 to 10,000. The tests call the real builder without an LLM, network or mocks.

## Run, triage and fix

Before the fixes, R1 and R3 passed. R2 and R7 failed.

| Requirement | Smallest failing example | What was wrong | Fix |
|---|---|---|---|
| R2 | Change: `handle empty input in a by returning []`; test: `empty input`; location: `src/a.ts:1`; command: `bun test test/a.test.ts`. | The reproduction step left out the location and command. It also did not include supplied failed-test names. | Include the supplied failed-test names, location and command in that step. |
| R7 | Change: `handle empty input in a by returning []`; move `src/old-a.ts:1` to `src/new-a.ts:2`. | The failure recommendation left out the location and used a general explanation that did not describe the expected `[]` behavior. | Show the location and explain the proposed behavior being checked without the original error. |

After the fixes: 9 tests passed, 0 failed. This includes all four properties (800 generated cases) and the five existing builder tests.

Run from `packages/opencode`:

```sh
bun test test/session/testing-strategy.test.ts test/session/testing-strategy.property.test.ts
```

`fast-check` is already a development dependency. `opencode#test` is already listed in `turbo.json`. The test workflow also runs these properties in a separate named step so their results are visible in the PR log.

This PR stays open against `main` for the next project.
