# User Guide

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