import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Fiber, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Question } from "@/question"
import { MessageID, SessionID } from "@/session/schema"
import { ShellID } from "@/tool/shell/id"
import { ExplainErrorTool } from "@/tool/explain-error"
import { GuidedDebugTool } from "@/tool/guided-debug"
import { TestingStrategyTool } from "@/tool/testing-strategy"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, Truncate.node, Agent.node])),
)

const fix = "return a + b"
const change = "make add combine its two arguments correctly"

// A shell command that finished with a nonzero exit code, as the student would see it.
const messages = [
  { info: { role: "user" }, parts: [{ type: "text", text: "My calculator tests fail" }] },
  {
    info: { role: "assistant" },
    parts: [
      {
        type: "tool",
        tool: ShellID.ToolID,
        state: {
          status: "completed",
          input: { command: "bun test" },
          output: "error: expect(received).toBe(5)\n    at add (/repo/src/calculator.ts:8:3)",
          metadata: { exit: 1 },
        },
      },
    ],
  },
] as unknown as SessionV1.WithParts[]

const ctx = {
  sessionID: SessionID.make("ses_guided-flow"),
  messageID: MessageID.make("msg_guided-flow"),
  callID: "guided-flow-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages,
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const pending = Effect.fn("GuidedDebuggingFlowTest.pending")(function* (question: Question.Interface) {
  const events = yield* EventV2Bridge.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* events.listen((event) => {
    if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  for (;;) {
    const item = (yield* question.list())[0]
    if (item) return item
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

// Runs the three tools in the order the guided_debug description asks for.
const run = Effect.gen(function* () {
  const explainTool = yield* (yield* ExplainErrorTool).init()
  const strategyTool = yield* (yield* TestingStrategyTool).init()
  const guidedTool = yield* (yield* GuidedDebugTool).init()

  const explained = yield* explainTool.execute({}, ctx)
  const strategy = yield* strategyTool.execute({ proposedChange: change }, ctx)
  const evidence = explained.output.slice(0, explained.output.indexOf("## How to explain this to the student"))

  return { guidedTool, explained, strategy, evidence }
})

describe("guided debugging flow", () => {
  it.instance("takes a failed shell command through explanation, tests, then the fix", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const { guidedTool, explained, strategy } = yield* run
      const explanation = "The add function subtracts. See src/calculator.ts line 8."

      // Each earlier step is grounded in the failure and holds back the fix.
      expect(explained.output).toContain("calculator.ts line 8")
      expect(explained.output).toContain("## Response format")
      expect(strategy.output).toContain("expect(received).toBe(5)")

      const fiber = yield* guidedTool
        .execute({ explanation, testingStrategy: strategy.output }, ctx)
        .pipe(Effect.forkScoped)

      const first = yield* pending(question)
      expect(first.questions[0]?.header).toBe("Error explanation")
      expect(first.questions[0]?.question).toContain(explanation)
      expect(first.questions[0]?.question).not.toContain("Recommended tests")
      yield* question.reply({ requestID: first.id, answers: [["Review testing strategy"]] })

      const second = yield* pending(question)
      expect(second.questions[0]?.header).toBe("Testing strategy")
      expect(second.questions[0]?.question).toContain("Recommended tests (not yet run)")
      expect(second.questions[0]?.options.map((option) => option.label)).toEqual([
        "Show proposed fix",
        "Keep investigating",
      ])
      yield* question.reply({ requestID: second.id, answers: [["Show proposed fix"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.decision).toBe("show_fix")
    }),
  )

  it.instance("shows no fix before the student asks for it", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const { guidedTool, explained, strategy, evidence } = yield* run

      expect(evidence).not.toMatch(/fix/i)
      expect(explained.output).toContain("Do not include, suggest, or apply a fix.")
      expect(strategy.output).not.toContain(fix)

      const fiber = yield* guidedTool
        .execute({ explanation: "The add function subtracts.", testingStrategy: strategy.output }, ctx)
        .pipe(Effect.forkScoped)
      const first = yield* pending(question)
      yield* question.reply({ requestID: first.id, answers: [["Review testing strategy"]] })
      const second = yield* pending(question)
      yield* question.reply({ requestID: second.id, answers: [["Keep investigating"]] })
      const result = yield* Fiber.join(fiber)

      expect(result.metadata.decision).toBe("keep_investigating")
      expect(result.output).toContain("Do not present or apply the proposed fix")
    }),
  )

  it.instance("does not claim tests passed unless there is evidence", () =>
    Effect.gen(function* () {
      const { strategy } = yield* run

      expect(strategy.output).toContain("No test runs with evidence were provided.")
      expect(strategy.output).toContain("### Recommended tests (not yet run)")
      expect(strategy.output).not.toMatch(/passed/i)
    }),
  )

  it.instance("tells OpenCode to run explain_error before testing_strategy before guided_debug", () =>
    Effect.gen(function* () {
      const { guidedTool } = yield* run
      const description = guidedTool.description

      expect(description.indexOf("explain_error")).toBeGreaterThan(-1)
      expect(description.indexOf("explain_error")).toBeLessThan(description.indexOf("testing_strategy"))
    }),
  )
})
