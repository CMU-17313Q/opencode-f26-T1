import { Effect, Schema } from "effect"
import { Question } from "../question"
import { Tool } from "./tool"
import DESCRIPTION from "./guided-debug.txt"

export const Parameters = Schema.Struct({
  explanation: Schema.String.annotate({
    description: "A student-friendly explanation of the error's cause and relevant context. Do not include the fix.",
  }),
  testingStrategy: Schema.String.annotate({
    description: "How the proposed change should be tested and why. Do not include the fix.",
  }),
})

type Metadata = {
  decision: "show_fix" | "keep_investigating"
  explanation: string
  testingStrategy: string
}

const showFix = "Show proposed fix"
const reviewTestingStrategy = "Review testing strategy"

export const GuidedDebugTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "guided_debug",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const tool = ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined
          const keepInvestigating = {
            title: "Student kept investigating",
            output:
              "The student chose to keep investigating. Do not present or apply the proposed fix. Continue helping with the explanation, evidence, or testing strategy instead.",
            metadata: {
              decision: "keep_investigating" as const,
              explanation: params.explanation,
              testingStrategy: params.testingStrategy,
            },
          }

          const explanationAnswers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                header: "Error explanation",
                question: `Error explanation: ${params.explanation}`,
                options: [
                  {
                    label: reviewTestingStrategy,
                    description: "Continue to review how the proposed change should be tested.",
                  },
                  {
                    label: "Keep investigating",
                    description: "Continue exploring the error without moving to the proposed fix.",
                  },
                ],
                multiple: false,
                custom: false,
              },
            ],
            tool,
          })
          if (!explanationAnswers[0]?.includes(reviewTestingStrategy)) return keepInvestigating

          const strategyAnswers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                header: "Testing strategy",
                question: `Testing strategy: ${params.testingStrategy} Would you like to see the proposed fix?`,
                options: [
                  {
                    label: showFix,
                    description: "Continue to the proposed fix after reviewing the explanation and testing strategy.",
                  },
                  {
                    label: "Keep investigating",
                    description: "Continue exploring without seeing or applying the proposed fix.",
                  },
                ],
                multiple: false,
                custom: false,
              },
            ],
            tool,
          })
          if (!strategyAnswers[0]?.includes(showFix)) return keepInvestigating

          return {
            title: "Student requested the proposed fix",
            output:
              "The student reviewed the explanation and testing strategy and chose to continue. You may now present the proposed fix. Apply it only when the student's request and normal permissions allow it.",
            metadata: {
              decision: "show_fix" as const,
              explanation: params.explanation,
              testingStrategy: params.testingStrategy,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
