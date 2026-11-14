# Traceability: Bel Ami Gisage Warakoze (bgisagew)

**Target feature:** `explain_error`, the guided-debugging tool that explains the latest failure without proposing a fix. Source: [explain-error.ts](../packages/opencode/src/tool/explain-error.ts), [error-explanation.ts](../packages/opencode/src/session/error-explanation.ts), [error-context.ts](../packages/opencode/src/session/error-context.ts).

IDs match my P4A workbook (R1 there was the template example). Properties: [explain-error.property.test.ts](../packages/opencode/test/tool/explain-error.property.test.ts).

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R2 | C-3, C-4, O-4 | The explain_error result never proposes a fix, tells the agent not to, and ends by asking whether the student wants help with one. The response check flags any reply that proposes a fix. | Any failure: result contains "Do not include, suggest, or apply a fix." and ends with the question. A four-section reply passes the check; the same reply plus `### Solution` or "To fix this, change X to Y" is flagged. | Yes | Result never proposes a fix; check flags every added fix (invariant) | `R2 [invariant]` (two tests) |
| R3 | S-4, O-10 | Confidence is stated. It is "high" only when the error is recognized and points to a file and line. Missing information is listed. | `Cannot read properties of undefined` at `src/cart.ts:12`: high. `Cannot find module 'lodsh'` with no line: medium. Pasted "Widget exploded": low, "which file failed" missing. | No | Confidence and missing file match a model built from how the failure was generated (model/oracle) | `R3 [model/oracle]` |
| R4 | S-2, S-3, S-9 | For "cannot find module", the hint names a misspelled import name or path as an equally likely cause as a missing package. | `Cannot find module 'lodsh' from '/repo/src/index.ts'`: hint names both causes, confidence not high. | No | Every unresolved import (Bun, Node, tsc, Vite formats) names both causes and is never high (invariant) | `R4 [invariant]` |
| R5 | C-8, O-8 | The explanation covers only the most recent failure. Earlier failures and later messages that are not a passing rerun of the failed command don't change it. | ENOENT on `old.ts`, then `bun test` failure at `math.test.ts:8`, then "Now rename the button": cites `math.test.ts line 8` and `add`, not `old.ts` or the button. | Yes | Earlier failures and unrelated later events leave the output unchanged (metamorphic) | `R5 [metamorphic]` |
| R6 | C-7, O-7 | The same error in another file or line keeps its cause and reports the new location. | Same TypeError at `getTotal (src/cart.ts:12)` then `(src/order.ts:30)`: same hint and confidence; each names its own file and line. | No | Moving a located error keeps hint and confidence and lists only the new location (metamorphic) | `R6 [metamorphic]` |
| R7 | C-9, O-9 | Every listed file and function comes from the recorded failure: the output, an attached file, or the file the failed step was working on. | Trace `at add (/repo/src/math.test.ts:8:18)`: exactly `/repo/src/math.test.ts line 8` and `add`. A failed edit of `src/cart.ts` may list `src/cart.ts`. | Yes | Each listed file and function is traceable to the output, an attachment, or the step's file (invariant) | `R7 [invariant]` |
| R8 | C-6, S-6, O-6 | If the failed command was rerun and passed, the explanation still covers the failure and says the latest run passed. | `bun test` fails at `math.test.ts:8`, revert, `bun test` exits 0, "what went wrong?": describes line 8 and says a later run passed. | No | Fail, pass, fail again returns the first explanation; after the pass the evidence is kept and the pass is reported (round-trip) | `R8 [round-trip]` |
| R9 | S-7, S-8 | A pasted error gets the same diagnosis as the same error from a session command. With no command known, the explanation says so. | Same trace from `bun test` and pasted: same hint, confidence, evidence. Pasted names no command and lists "which command was run" as missing. | No | Moving the error text to the paste box keeps the diagnosis and reports the command as missing (metamorphic) | `R9 [metamorphic]` |

## Requirement changes

| ID | Original requirement (P4A) | Revised requirement | Why it changed |
|---|---|---|---|
| R2 | The explanation describes the cause without proposing a fix and ends by asking whether they want help fixing it. | The tool result never proposes a fix and the response check flags any reply that does. | Checkability: the reply is written by the model, so code can't guarantee its wording. The tool controls its own result and the check. |
| R5 | Messages sent after the failure don't change the explanation. | Later messages that are not a passing rerun of the failed command don't change it. | Conflict with R8, which requires reporting a passing rerun. C-8 and O-8 were about unrelated messages. |
| R7 | Evidence appears in the failure output or is an attached file. | Evidence may also be the file the failed step was working on. | Conflict with R3: a failed edit knows its file but the error text often omits it; dropping it would make R3 report the file as missing. |

R3, R4, R6, R8, R9 kept as written: concrete inputs, checkable outputs, no conflicts.

## Run, triage, and fixes

First run against unmodified `main` (`97eb0bc`), seed `17313`, 200 cases each. R2 (result), R5, R6, R7 passed. Failures:

| Property | Shrunk counterexample | Triage | Fix |
|---|---|---|---|
| R2 check | Four-section reply plus `### Solution` not flagged (`### How to fix it` too). | Code bug | `check()` also flags "how to fix" and "solution" headings. |
| R3 | `src/a.ts(1,1): error TS2307: Cannot find module 'a'` was high, model says medium. | Code bug (same as R4) | Unresolved imports stay medium even with a location. |
| R4 | `Cannot find module 'lodsh'` hint named only a missing module. | Code bug, unimplemented | New hint names both causes; Vite "Failed to resolve import" recognized. |
| R4 (rerun) | Hint says "may not be installed"; test wanted literal "not installed". | Wrong test | Property matches `/not (be )?installed/`. |
| R8 | `bun test` fails, then passes: pass never mentioned. | Code bug, unimplemented | `ErrorContext.latest` marks a passing rerun; explanation reports it. |
| R9 | Pasted error did not list the command as missing. | Code bug, unimplemented | Pasted errors list "which command was run"; one unit test updated. |

All nine properties pass (seed `17313` and 20 random seeds). 83 related tests, `bun typecheck`, and the coverage gate (100% lines) pass. Run from `packages/opencode`: `bun test test/tool/explain-error.property.test.ts`. CI runs the file in the unit job and the Fast-check job; each property prints a `P4B bgisagew ...` line.
