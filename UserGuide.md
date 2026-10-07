# User Guide: Guided Debugging

## What it does

_What guided debugging is and what a student sees, in two or three sentences (#20)._

## How to use it

_Steps to try it on a small failing example: the example file, how to start OpenCode, what to ask, and what to choose at each prompt (#20)._

## How to test it

_Manual check: what to confirm when following the steps above (#20)._

_Automated tests: the command that runs all guided debugging tests, and what they cover (#20)._

## Contributions

This feature was built by Team T1 over two sprints. Each member owned one part, and the parts were connected through pull requests and code reviews.

**@Ahmed120515: Error context (#4).** Added the error-context collector, which captures explicit tool errors and completed shell commands with nonzero exit codes. It preserves available output, command input, exit code, and the latest user task and supplied file context. It ignores successful, unfinished, and interrupted tool calls and handles missing information gracefully. Tests in [error-context.test.ts](packages/opencode/test/session/error-context.test.ts) cover failure detection, ignored cases, incomplete data, and task/file context.

**@belamigw: Error explanation (#5).** Added the `explain_error` tool. When something fails, it finds the error that just happened, picks out the file, line and error message, and rates how sure it is, so OpenCode can explain the cause without giving the fix. Tests in [`packages/opencode/test/tool/explain-error.test.ts`](packages/opencode/test/tool/explain-error.test.ts) check that it uses only the latest failure, finds the right file, never includes a fix, and is unsure when the error is unclear.

**@akkubais: Testing strategy (#6).** Added the TestingStrategy builder. It uses the proposed change and available error context to recommend relevant normal, edge, and failure tests, explains why each test is useful, and keeps completed tests separate from recommendations. Tests in packages/opencode/test/session/testing-strategy.test.ts check relevant recommendations, evidence-backed results, incomplete context, edge-case detection, and readable multiline errors.

**@hlabda: Guided debugging flow (#7).** Added the `guided_debug` tool using OpenCode's existing question service. It presents the error explanation and testing strategy in separate steps, lets the student keep investigating at either step, and permits presenting a proposed fix only after the student chooses to continue. It inherits question-denial permissions and can be disabled independently. Tests cover the [main flow and both stop paths](packages/opencode/test/tool/guided-debug.test.ts), [permissions](packages/opencode/test/permission/next.test.ts), [tool registration](packages/opencode/test/tool/registry.test.ts), and CLI question [cleanup](packages/opencode/test/cli/run/session-data.test.ts) and [recovery](packages/opencode/test/cli/run/stream.transport.test.ts).

**@a-belard: Response format (#9).** _Description of the response format and a link to its tests._
