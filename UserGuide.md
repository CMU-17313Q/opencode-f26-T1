# User Guide

## Guided Debugging (issue #7)

Guided Debugging helps a student examine an error before seeing a proposed fix. In an interactive OpenCode client that supports questions, ask OpenCode to help debug an error and to explain it before suggesting a change. When the agent uses the built-in `guided_debug` tool, the student sees two prompts in order:

1. **Error explanation.** Read the explanation and choose **Review testing strategy** to continue, or **Keep investigating** to stop before seeing the strategy or fix.
2. **Testing strategy.** Read how the proposed change should be tested and choose **Show proposed fix** to allow the agent to present it, or **Keep investigating** to stop without seeing it.

The tool does not apply a fix automatically. Choosing **Show proposed fix** only allows the agent to present one; applying changes still depends on the student's request and OpenCode's normal permissions. The explanation and testing strategy are supplied by the agent, with the related error-explanation and testing-strategy work tracked in issues #5 and #6. This tool controls their order and the student's choice to continue.

### Manual test

1. Open an interactive OpenCode session with questions enabled. Give the agent a reproducible error and ask it to use guided debugging before proposing a fix.
2. Confirm that the first prompt explains the error without showing a fix. Choose **Review testing strategy**.
3. Confirm that the next prompt describes tests before offering **Show proposed fix**. Choose it and confirm that the agent can now present a proposed fix, without applying it unless you request that separately.
4. Repeat the workflow, choosing **Keep investigating** at each prompt in separate runs. Confirm that neither path reveals or applies a fix.
5. If configuring agent permissions, confirm that denying `question` hides `guided_debug`. Denying `guided_debug` alone should hide only guided debugging, leaving ordinary questions available.

### Automated tests

- [`packages/opencode/test/tool/guided-debug.test.ts`](packages/opencode/test/tool/guided-debug.test.ts) checks the explanation-to-strategy-to-fix order and both stop paths.
- [`packages/opencode/test/permission/next.test.ts`](packages/opencode/test/permission/next.test.ts) checks that the tool is hidden when questions are denied and that it can be disabled independently.
- [`packages/opencode/test/tool/registry.test.ts`](packages/opencode/test/tool/registry.test.ts) checks that the built-in tool is registered for question-capable clients.
- [`packages/opencode/test/cli/run/session-data.test.ts`](packages/opencode/test/cli/run/session-data.test.ts) and [`packages/opencode/test/cli/run/stream.transport.test.ts`](packages/opencode/test/cli/run/stream.transport.test.ts) check that an interactive CLI can recover and clear guided-debug questions if question events are missed.

Together these tests cover the issue's interaction order, student choices, permission restrictions, tool availability, and the CLI question lifecycle. The manual test checks the student-facing experience with an actual agent response.

## Error Context Collection — Issue #4

### Purpose and usage

The error-context collector gathers information needed by later guided-debugging features. It captures explicit tool errors and completed shell commands with nonzero exit codes.

When available, it includes:

- Error messages or command output.
- Tool name, input, and exit code.
- The latest user task.
- Supplied file references and code context.

Successful commands, tools still running, and user-interrupted errors are ignored. Missing information is left undefined or represented by an empty file list.

This is an internal component, with no standalone UI or command. Other features use `ErrorContext.collect(part, messages)`, supplying a tool part and message history up to the failure, oldest first. It does not read additional files, generate explanations, or apply fixes.

### Verification

From the repository root, run:

    cd packages/opencode
    bun test test/session/error-context.test.ts

All tests should pass.

To inspect representative behavior, open the test file and check:

1. A failed read records the error and affected file path.
2. A completed `bash` command with exit code 1 records its output and command.
3. Successful, unfinished, and interrupted tool calls return no error context.
4. Incomplete failure information is handled without throwing.
5. The latest user task and supplied file context are retained without modifying the inputs.

Student-facing verification of the complete debugging flow should be performed after integration with the features that consume this collector.

### Automated tests and coverage

Implementation: `packages/opencode/src/session/error-context.ts`

Tests: `packages/opencode/test/session/error-context.test.ts`

The tests cover explicit tool errors, failed shell commands, output selection, invalid exit codes, ignored tool states, interrupted errors, malformed or missing details, and task/file context.

These cases cover issue #4's acceptance criteria: receiving failure information, including available context, handling incomplete data gracefully, and verifying collection behavior automatically. They verify the collector itself; they do not establish that the complete guided-debugging flow works.

## Error Explanation — Issue #5

### What it does

When something fails, OpenCode can call the `explain_error` tool before suggesting a fix. The tool finds the error that just happened, picks out the file, line, and error message, and says how sure it is. OpenCode then explains the cause in simple words, without giving the fix.

### Manual test

1. In an empty folder, create `sum.test.ts`:

   ```ts
   import { expect, test } from "bun:test"
   test("adds", () => expect(1 + 1).toBe(3))
   ```

2. From the repository root, run `bun dev <path-to-folder>`.
3. Ask: "Run bun test, then explain why it failed before suggesting a fix."
4. Confirm that the reply names `sum.test.ts` line 2 and does not include a fix.

### Automated tests

[`packages/opencode/test/tool/explain-error.test.ts`](packages/opencode/test/tool/explain-error.test.ts) checks that the tool:

- Explains the error that just happened, using only messages up to it.
- Finds the file, line, and function, and never includes a fix.
- Catches a `bash` command that exits with an error.
- Is unsure when the error is unclear, and asks for the error when nothing failed.

These cover each acceptance criterion of issue #5. The two bugs found in review each have a test that fails on the old code. The exact wording from the AI model is checked by the manual test.
