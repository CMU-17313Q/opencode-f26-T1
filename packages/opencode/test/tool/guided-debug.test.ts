import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Question } from "@/question"
import { MessageID, SessionID } from "@/session/schema"
import { GuidedDebugTool } from "@/tool/guided-debug"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_guided-debug"),
  messageID: MessageID.make("msg_guided-debug"),
  callID: "guided-debug-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, Truncate.node, Agent.node])),
)

const pending = Effect.fn("GuidedDebugToolTest.pending")(function* (question: Question.Interface) {
  const events = yield* EventV2Bridge.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* events.listen((event) => {
    if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

const params = {
  explanation: "The parser reaches the end of the file while a bracket is still open.",
  testingStrategy: "Reproduce the failure, test balanced brackets, and test an empty file.",
}

describe("tool.guided_debug", () => {
  it.instance("shows the explanation and testing strategy in order before allowing the fix", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* GuidedDebugTool
      const tool = yield* toolInfo.init()

      const fiber = yield* tool.execute(params, ctx).pipe(Effect.forkScoped)
      const explanationItem = yield* pending(question)
      const explanationPrompt = explanationItem.questions[0]

      expect(explanationPrompt?.header).toBe("Error explanation")
      expect(explanationPrompt?.question).toContain(params.explanation)
      expect(explanationPrompt?.question).not.toContain(params.testingStrategy)
      expect(explanationPrompt?.options.map((option) => option.label)).toEqual([
        "Review testing strategy",
        "Keep investigating",
      ])

      yield* question.reply({ requestID: explanationItem.id, answers: [["Review testing strategy"]] })
      const strategyItem = yield* pending(question)
      const strategyPrompt = strategyItem.questions[0]

      expect(strategyPrompt?.header).toBe("Testing strategy")
      expect(strategyPrompt?.question).toContain(params.testingStrategy)
      expect(strategyPrompt?.options.map((option) => option.label)).toEqual(["Show proposed fix", "Keep investigating"])

      yield* question.reply({ requestID: strategyItem.id, answers: [["Show proposed fix"]] })
      const result = yield* Fiber.join(fiber)

      expect(result.metadata.decision).toBe("show_fix")
      expect(result.output).toContain("may now present the proposed fix")
      expect(result.output).toContain("normal permissions")
    }),
  )

  it.instance("keeps the fix hidden when the student wants to investigate", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* GuidedDebugTool
      const tool = yield* toolInfo.init()

      const fiber = yield* tool.execute(params, ctx).pipe(Effect.forkScoped)
      const explanationItem = yield* pending(question)
      yield* question.reply({ requestID: explanationItem.id, answers: [["Review testing strategy"]] })
      const strategyItem = yield* pending(question)
      yield* question.reply({ requestID: strategyItem.id, answers: [["Keep investigating"]] })
      const result = yield* Fiber.join(fiber)

      expect(result.metadata.decision).toBe("keep_investigating")
      expect(result.output).toContain("Do not present or apply the proposed fix")
    }),
  )

  it.instance("stops after the explanation when the student is not ready for the testing strategy", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* GuidedDebugTool
      const tool = yield* toolInfo.init()

      const fiber = yield* tool.execute(params, ctx).pipe(Effect.forkScoped)
      const explanationItem = yield* pending(question)
      yield* question.reply({ requestID: explanationItem.id, answers: [["Keep investigating"]] })
      const result = yield* Fiber.join(fiber)

      expect(result.metadata.decision).toBe("keep_investigating")
      expect(result.output).not.toContain(params.testingStrategy)
      expect(result.output).toContain("Do not present or apply the proposed fix")
    }),
  )
})
