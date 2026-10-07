import { Effect, Schema } from "effect"
import { ErrorContext } from "../session/error-context"
import { TestingStrategy } from "../session/testing-strategy"
import { Tool } from "./tool"
import DESCRIPTION from "./testing-strategy.txt"

export const Parameters = Schema.Struct({
  proposedChange: Schema.String.annotate({
    description:
      'What the change is meant to achieve, in a few general words (for example "handle empty input"). Do not write the fix or any code: the student sees this text before choosing to see the fix.',
  }),
  executed: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        result: Schema.Literals(["passed", "failed"]),
        evidence: Schema.String.annotate({ description: "The output that shows this result." }),
      }),
    ),
  ).annotate({
    description: "Tests that were actually run in this session, with evidence. Leave out anything not run.",
  }),
  error: Schema.optional(Schema.String).annotate({
    description: "Error text the student pasted, when the failure did not come from a tool call in this session.",
  }),
})

type Metadata = { found: boolean }

export const TestingStrategyTool = Tool.define<typeof Parameters, Metadata, never>(
  "testing_strategy",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.sync(() => {
        const context = ErrorContext.latest(ctx.messages, params.error)

        return {
          title: "Testing strategy",
          output: TestingStrategy.generate({
            proposedChange: params.proposedChange,
            context,
            executed: params.executed,
          }),
          metadata: { found: context !== undefined },
        }
      }),
  }),
)
