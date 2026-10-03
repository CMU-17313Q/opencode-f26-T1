import { Effect, Schema } from "effect"
import { ErrorContext } from "../session/error-context"
import { ErrorExplanation } from "../session/error-explanation"
import { Tool } from "./tool"
import DESCRIPTION from "./explain-error.txt"

export const Parameters = Schema.Struct({
  error: Schema.optional(Schema.String).annotate({
    description: "Error text the student pasted, when the failure did not come from a tool call in this session.",
  }),
})

type Metadata = { found: boolean; confidence?: ErrorExplanation.Confidence }

export const ExplainErrorTool = Tool.define<typeof Parameters, Metadata, never>(
  "explain_error",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.sync(() => {
        const context = params.error?.trim()
          ? ErrorContext.collect({ type: "tool", state: { status: "error", error: params.error } }, ctx.messages)
          : ctx.messages
              .flatMap((message, index) =>
                message.parts.map((part) => ErrorContext.collect(part, ctx.messages.slice(0, index + 1))),
              )
              .findLast((found) => found !== undefined)

        if (!context)
          return {
            title: "No failure found",
            output: "No failed tool call was found. Ask the student to paste the error message or command output.",
            metadata: { found: false },
          }

        const explanation = ErrorExplanation.create(context)

        return {
          title: "Collected error evidence",
          output: ErrorExplanation.format(explanation),
          metadata: { found: true, confidence: explanation.confidence },
        }
      }),
  }),
)
