# User Guide: Guided Debugging

Guided debugging helps you understand a failing test before OpenCode fixes it. OpenCode:

1. Explains what went wrong.
2. Suggests how to test a fix.
3. Shows the fix only if you ask.

## Before you start

You need:

- **Bun.** Install it from [bun.sh](https://bun.sh) using the instructions for your system, then open a new terminal.
- **This repository** with its dependencies. In the repository folder, run `bun install`.
- **An AI model that can use tools.** This guide uses [OpenRouter](https://openrouter.ai). Create an account and an API key there. Do not pick a "Content Safety" model; it cannot use tools.

## Try it on an example

1. Create a folder called `guided-demo` anywhere, for example on your Desktop. You can delete it when you are done.

2. In that folder, create `calculator.ts`. It has a bug: it subtracts instead of adding.

   ```ts
   export function add(a: number, b: number) {
     return a - b
   }
   ```

3. In the same folder, create `calculator.test.ts`:

   ```ts
   import { expect, test } from "bun:test"
   import { add } from "./calculator"

   test("adds positive numbers", () => expect(add(2, 3)).toBe(5))
   test("adds zero", () => expect(add(4, 0)).toBe(4))
   test("adds negative numbers", () => expect(add(-2, -3)).toBe(-5))
   ```

4. Open a terminal in the repository folder and start OpenCode in your `guided-demo` folder. Replace the path with where you created it:

   ```bash
   bun run dev path/to/guided-demo
   ```

5. Connect a model. Type `/connect`, choose **OpenRouter**, and paste your API key. Then type `/models` and pick a model.

6. Paste this request and press Enter:

   > Run bun test for this calculator project. If it fails, use explain_error, then testing_strategy, then guided_debug to help me understand the failure and testing strategy. Do not show or apply the fix until I approve through guided_debug. Only claim tests passed if you actually ran them and saw passing results.

7. Follow the prompts:

   | You see               | Check that                                              | Choose                      |
   | --------------------- | ------------------------------------------------------- | --------------------------- |
   | The test run          | It shows 1 pass and 2 fail                              |                             |
   | **Error explanation** | It says `add` in `calculator.ts` subtracts, with no fix | **Review testing strategy** |
   | **Testing strategy**  | It lists tests to try, marked as not yet run            | **Show proposed fix**       |

   Choose **Keep investigating** at either prompt to stop without seeing the fix.

8. To apply the fix, type:

   > Apply the fix to calculator.ts only, leave the tests unchanged, and run bun test again.

   The tests should now show **3 pass, 0 fail**.

9. When you are done, close OpenCode with Ctrl+C and delete the `guided-demo` folder.

## Troubleshooting

| Problem                                    | What to do                                                    |
| ------------------------------------------ | ------------------------------------------------------------- |
| "No endpoints found that support tool use" | The model cannot use tools. Type `/models` and pick another.  |
| "Rate limited"                             | Wait a minute or pick another model. Free models are limited. |
| OpenCode skips a step or never asks you    | Ask it directly, for example: "Use explain_error now."        |

## Run the automated tests

From the repository folder:

```bash
cd packages/opencode
bun test test/session/error-context.test.ts test/session/error-explanation.test.ts test/session/testing-strategy.test.ts test/tool/explain-error.test.ts test/tool/testing-strategy.test.ts test/tool/guided-debug.test.ts test/tool/guided-debugging-flow.test.ts
```

All tests should pass. They check each part and the full flow: the explanation comes first, the fix waits for your approval, and tests are only reported as passed when they actually ran.

**Recorded walkthrough.** We ran this example on 7 October 2026 with GPT-6.1 Sol through OpenRouter. Results and screenshots are on [issue #20](https://github.com/CMU-17313Q/opencode-f26-T1/issues/20#issuecomment-6034222793).

**Known limitation.** The explanation may not recognize some Bun error wording, such as `undefined is not an object`. OpenCode still receives the full error output.

## Contributions

This feature was built by Team T1 over two sprints. Each member owned one part, and the parts were connected through pull requests and code reviews.

- **@Ahmed120515: Error context (#4).** Added the error-context collector, which captures explicit tool errors and completed shell commands with nonzero exit codes. It preserves available output, command input, exit code, and the latest user task and supplied file context. It ignores successful, unfinished, and interrupted tool calls and handles missing information gracefully. Tests in [error-context.test.ts](packages/opencode/test/session/error-context.test.ts) cover failure detection, ignored cases, incomplete data, and task/file context.
- **@belamigw: Error explanation (#5).** Added the `explain_error` tool. When something fails, it finds the error that just happened, picks out the file, line and error message, and rates how sure it is, so OpenCode can explain the cause without giving the fix. Tests in [`packages/opencode/test/tool/explain-error.test.ts`](packages/opencode/test/tool/explain-error.test.ts) check that it uses only the latest failure, finds the right file, never includes a fix, and is unsure when the error is unclear.
- **@akkubais: Testing strategy (#6).** Added the TestingStrategy builder. It uses the proposed change and available error context to recommend relevant normal, edge, and failure tests, explains why each test is useful, and keeps completed tests separate from recommendations. Tests in packages/opencode/test/session/testing-strategy.test.ts check relevant recommendations, evidence-backed results, incomplete context, edge-case detection, and readable multiline errors.
- **@hlabda: Guided debugging flow (#7).** Added the `guided_debug` tool using OpenCode's existing question service. It presents the error explanation and testing strategy in separate steps, lets the student keep investigating at either step, and permits presenting a proposed fix only after the student chooses to continue. It inherits question-denial permissions and can be disabled independently. Tests cover the [main flow and both stop paths](packages/opencode/test/tool/guided-debug.test.ts), [permissions](packages/opencode/test/permission/next.test.ts), [tool registration](packages/opencode/test/tool/registry.test.ts), and CLI question [cleanup](packages/opencode/test/cli/run/session-data.test.ts) and [recovery](packages/opencode/test/cli/run/stream.transport.test.ts).
- **@a-belard: Response format (#9) and integration (#16).** Added the response format that `explain_error` gives OpenCode: what went wrong, where it happened, why it happened, and how sure it is. It keeps the explanation separate from the fix and states uncertainty when confidence is low. Also added the `testing_strategy` tool and told `guided_debug` to run `explain_error` and `testing_strategy` first. Tests in [`error-explanation.test.ts`](packages/opencode/test/session/error-explanation.test.ts) check the sections, the uncertainty wording, and that the fix stays out. A [flow test](packages/opencode/test/tool/guided-debugging-flow.test.ts) checks the order from error to tests to fix.
