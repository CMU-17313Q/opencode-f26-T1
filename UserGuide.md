# User Guide: Guided Debugging

## What it does

Guided debugging helps students understand an error and how to test a change before seeing a proposed fix. OpenCode explains the failure, presents a testing strategy, and asks whether to continue or keep investigating. It distinguishes actual test results from recommended checks that have not been run.

## How to use it

Use a version containing the integration from PR #22. The walkthrough below was verified on branch `integrate-guided-debug`, commit `e0690dd`.

You need Bun and the repository dependencies installed (`bun install` from the repository root), plus a connected model that supports tool calls.

### Create a failing calculator example

From the repository root, run these commands on macOS or Linux:

```bash
guided_demo=$(mktemp -d /tmp/opencode-guided-XXXXXX)

cat > "$guided_demo/calculator.ts" <<'EOF'
export function add(a: number, b: number) {
  return a - b
}
EOF

cat > "$guided_demo/calculator.test.ts" <<'EOF'
import { expect, test } from "bun:test"
import { add } from "./calculator"

test("adds positive numbers", () => {
  expect(add(2, 3)).toBe(5)
})

test("adds zero", () => {
  expect(add(4, 0)).toBe(4)
})

test("adds negative numbers", () => {
  expect(add(-2, -3)).toBe(-5)
})
EOF

bun run dev "$guided_demo"
```

This opens the local OpenCode implementation in a temporary project outside the repository.

### Run the guided workflow

Use `/connect` to connect a provider if needed, then `/models` to select a model. Our recorded walkthrough used OpenRouter. If a free model is rate-limited, select another available model while keeping the team's shared credit budget in mind.

Paste this request into OpenCode:

> Run bun test for this calculator project. If it fails, use explain_error, then testing_strategy, then guided_debug to help me understand the failure and testing strategy. Do not show or apply the fix until I approve through guided_debug. Only claim tests passed if you actually ran them and saw passing results.

1. The initial test run should report **1 pass and 2 failures**.
2. Read the error explanation, then choose **Review testing strategy**.
3. Read the testing strategy, then choose **Show proposed fix** when ready. Choosing **Keep investigating** at either prompt should stop progression to the fix.
4. To explicitly authorize the edit and verification, say: **Apply the fix to calculator.ts only, leave the tests unchanged, and run bun test again.**
5. Confirm that `calculator.ts` now returns `a + b` and the test rerun reports **3 pass, 0 fail**.

### What each stage provides

- `explain_error` collects the failure evidence and requests an explanation with four sections: **What went wrong**, **Where it happened**, **Why it happened**, and **How sure I am**. It should acknowledge missing information or uncertainty.
- `testing_strategy` uses the proposed change goal and available error context to recommend relevant normal, edge, and failure cases. It explains why to check them and separates supplied test-run evidence from recommendations.
- `guided_debug` presents the explanation and testing strategy in order and asks for the student's decision before allowing the proposed fix to be shown.

The model coordinates the tool calls. Showing a proposed fix and applying a change are separate actions; edits still depend on the student's request and normal permissions.

## How to test it

### Manual verification

Follow the calculator example and confirm:

- The initial failing test output is captured.
- The agent calls `explain_error`, then `testing_strategy`, then `guided_debug`.
- The explanation identifies the subtraction in `calculator.ts` and the failed assertions.
- The testing strategy appears before the proposed fix.
- The fix is withheld until approval.
- After the approved change, the original tests pass without being removed or weakened.
- Additional recommended checks are not described as completed unless they were actually run.

Save screenshots or a short recording of the tool calls, explanation, testing strategy, and final test results. Record the commit, model, and runtime used.

To verify a stop path separately, choose **Keep investigating** and confirm that no fix is shown or applied.

### Recorded calculator walkthrough

On 7 October 2026, Ahmad tested branch `integrate-guided-debug` at commit `e0690dd`, using macOS, Bun 1.3.14, and GPT-6.1 Sol through OpenRouter.

The initial run reported **1 pass and 2 failures**. The workflow explained the error and presented the testing strategy before approval. After approval, the calculator was changed from subtraction to addition, and the rerun reported **3 pass, 0 fail**. The response explicitly stated that additional recommended edge cases had not been run.

[Results and screenshots are recorded on issue #20](https://github.com/CMU-17313Q/opencode-f26-T1/issues/20#issuecomment-6034222793).

These results apply to the tested branch commit, not a later merged version of `main`.

### Automated verification

From the repository root of a version containing PR #22, run:

```bash
cd packages/opencode
bun test test/session/error-context.test.ts test/session/error-explanation.test.ts test/session/testing-strategy.test.ts test/tool/explain-error.test.ts test/tool/testing-strategy.test.ts test/tool/guided-debug.test.ts test/tool/guided-debugging-flow.test.ts
```

These tests cover error collection, explanation evidence and formatting, testing recommendations, individual tools, and the combined flow. They also check approval behavior and the distinction between recommended tests and supplied test-run evidence.

Related permission, registry, and CLI question tests can be run with:

```bash
bun test test/permission/next.test.ts test/tool/registry.test.ts test/cli/run/session-data.test.ts test/cli/run/stream.transport.test.ts
```

Automated tests complement the live-model walkthrough; they do not establish that every model will follow the tool instructions correctly.

### Known limitations

An earlier check at commit `fa55913` found that the explanation parser did not recognize Bun's `undefined is not an object` wording or inline `[eval]` locations. The collector still recovered the failed command, output, and exit code. The successful calculator walkthrough does not establish that these parser limitations have been fixed.


## Contributions

This feature was built by Team T1 over two sprints. Each member owned one part, and the parts were connected through pull requests and code reviews.

**@Ahmed120515: Error context (#4).** Added the error-context collector, which captures explicit tool errors and completed shell commands with nonzero exit codes. It preserves available output, command input, exit code, and the latest user task and supplied file context. It ignores successful, unfinished, and interrupted tool calls and handles missing information gracefully. Tests in [error-context.test.ts](packages/opencode/test/session/error-context.test.ts) cover failure detection, ignored cases, incomplete data, and task/file context.

**@belamigw: Error explanation (#5).** Added the `explain_error` tool. When something fails, it finds the error that just happened, picks out the file, line and error message, and rates how sure it is, so OpenCode can explain the cause without giving the fix. Tests in [`packages/opencode/test/tool/explain-error.test.ts`](packages/opencode/test/tool/explain-error.test.ts) check that it uses only the latest failure, finds the right file, never includes a fix, and is unsure when the error is unclear.

**@akkubais: Testing strategy (#6).** Added the TestingStrategy builder. It uses the proposed change and available error context to recommend relevant normal, edge, and failure tests, explains why each test is useful, and keeps completed tests separate from recommendations. Tests in packages/opencode/test/session/testing-strategy.test.ts check relevant recommendations, evidence-backed results, incomplete context, edge-case detection, and readable multiline errors.

**@hlabda: Guided debugging flow (#7).** Added the `guided_debug` tool using OpenCode's existing question service. It presents the error explanation and testing strategy in separate steps, lets the student keep investigating at either step, and permits presenting a proposed fix only after the student chooses to continue. It inherits question-denial permissions and can be disabled independently. Tests cover the [main flow and both stop paths](packages/opencode/test/tool/guided-debug.test.ts), [permissions](packages/opencode/test/permission/next.test.ts), [tool registration](packages/opencode/test/tool/registry.test.ts), and CLI question [cleanup](packages/opencode/test/cli/run/session-data.test.ts) and [recovery](packages/opencode/test/cli/run/stream.transport.test.ts).

**@a-belard: Response format (#9).** _Description of the response format and a link to its tests._
