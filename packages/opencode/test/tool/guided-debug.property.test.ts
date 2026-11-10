import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber, Queue } from "effect"
import fc from "fast-check"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Question } from "@/question"
import { ErrorExplanation } from "@/session/error-explanation"
import { MessageID, SessionID } from "@/session/schema"
import { TestingStrategy } from "@/session/testing-strategy"
import { GuidedDebugTool } from "@/tool/guided-debug"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const seed = Number(process.env.FAST_CHECK_SEED ?? 17313)
if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) {
  throw new Error("FAST_CHECK_SEED must be a signed 32-bit integer")
}
const options = { numRuns: 300, seed, verbose: true }
console.info(`P4B hlabda: seed=${seed}, numRuns=${options.numRuns} per property`)

// Realistic POSIX paths include nested directories, spaces, Unicode, and JS/TS
// extensions. Positive line/column generators include the first source line.
const segment = fc
  .array(fc.constantFrom("a", "b", "0", "-", "_", " ", "é", "م"), { minLength: 1, maxLength: 12 })
  .map((parts) => parts.join(""))
const file = fc
  .tuple(fc.array(segment, { minLength: 1, maxLength: 3 }), fc.constantFrom("ts", "tsx", "js"))
  .map(([parts, extension]) => `/repo/src/${parts.join("/")}.${extension}`)
const location = fc.record({
  file,
  line: fc.integer({ min: 1, max: 100000 }),
  column: fc.integer({ min: 1, max: 1000 }),
  style: fc.constantFrom("stack", "diagnostic"),
})

// JSON encodes scalars on one diagnostic line, even for quotes/newlines in a
// string. Explicit boundaries reach zero, negatives, booleans, and null.
const value = fc
  .oneof(
    fc.constantFrom(0, -1, 5, null, true, false),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string({ maxLength: 80 }),
  )
  .map((input) => JSON.stringify(input))
const comparison = fc
  .tuple(value, value)
  .filter(([expected, actual]) => expected !== actual)
  .map(([expected, actual]) => ({ expected, actual }))
const diagnostic = fc.record({
  comparison,
  newline: fc.constantFrom("\n", "\r\n"),
  blank: fc.integer({ min: 0, max: 2 }),
  color: fc.boolean(),
  source: fc.constantFrom("error", "output"),
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, Truncate.node, Agent.node])),
)

const ctx = {
  sessionID: SessionID.make("ses_hlabda-properties"),
  messageID: MessageID.make("msg_hlabda-properties"),
  callID: "hlabda-properties",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const pending = Effect.fn("GuidedDebugProperty.pending")(function* (question: Question.Interface) {
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

// Besides the three normal paths, generate missing, contradictory, duplicated,
// extra-question, and unexpected answers to exercise fail-closed consent.
const answer = fc.oneof(
  fc.constant([["Review testing strategy"]]),
  fc.constant([["Show proposed fix"]]),
  fc.constant([["Keep investigating"]]),
  fc.array(
    fc.array(fc.constantFrom("Review testing strategy", "Show proposed fix", "Keep investigating", "Other"), {
      maxLength: 3,
    }),
    { maxLength: 3 },
  ),
)

describe("P4B hlabda: guided debugging properties", () => {
  // R1: When a diagnostic reports a source location, the first explanation
  // includes that reported file and line. Kind: model/oracle.
  test("R1 [model/oracle]: preserves reported source locations", () => {
    fc.assert(
      fc.property(location, (input) => {
        const output =
          input.style === "stack"
            ? `error: expect(received).toBe(expected)\n    at add (${input.file}:${input.line}:${input.column})`
            : `${input.file}(${input.line},${input.column}): error TS2322: invalid value`
        const explanation = ErrorExplanation.create({ output, files: [] })
        expect(explanation.evidence).toContain(`File: ${input.file} line ${input.line}`)
        expect(ErrorExplanation.format(explanation)).toContain(`- File: ${input.file} line ${input.line}`)
      }),
      {
        ...options,
        examples: [
          [{ file: "/repo/src/calculator.ts", line: 1, column: 1, style: "stack" }],
          [{ file: "/repo/src/ a.ts", line: 1, column: 1, style: "stack" }],
          [{ file: "/repo/src/م.ts", line: 1, column: 1, style: "diagnostic" }],
        ],
      },
    )
    console.info("P4B hlabda R1 [model/oracle]: 300 cases passed")
  })

  // R2: For a single-line Bun Expected/Received assertion pair, show both
  // supplied values separately without inventing missing values. Kind: model/oracle.
  test("R2 [model/oracle]: labels expected and actual assertion values", () => {
    fc.assert(
      fc.property(diagnostic, (input) => {
        const paint = (text: string) => (input.color ? `\u001b[31m${text}\u001b[39m` : text)
        const output = [
          "error: expect(received).toBe(expected)",
          paint(`Expected: ${input.comparison.expected}`),
          ...Array.from({ length: input.blank }, () => ""),
          paint(`Received: ${input.comparison.actual}`),
        ].join(input.newline)
        const explanation = ErrorExplanation.create({ [input.source]: output, files: [] })
        expect(explanation.evidence).toContain(`Expected: ${input.comparison.expected}`)
        expect(explanation.evidence).toContain(`Actual: ${input.comparison.actual}`)
        expect(ErrorExplanation.format(explanation)).toContain(`- Expected: ${input.comparison.expected}`)
        expect(ErrorExplanation.format(explanation)).toContain(`- Actual: ${input.comparison.actual}`)
        const incomplete = ErrorExplanation.create({ error: `Expected: ${input.comparison.expected}`, files: [] })
        expect(incomplete.evidence.some((item) => item.startsWith("Actual:"))).toBe(false)
      }),
      {
        ...options,
        examples: [
          [{ comparison: { expected: "5", actual: "-1" }, newline: "\n", blank: 0, color: false, source: "output" }],
        ],
      },
    )
    console.info("P4B hlabda R2 [model/oracle]: 300 cases passed")
  })

  // R3: Authorize the fix only after exactly one explicit continue answer at
  // each stage; all other replies stop without authorization. Kind: invariant.
  it.instance(
    "R3 [invariant]: requires unambiguous consent through both stages",
    () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const info = yield* GuidedDebugTool
        const tool = yield* info.init()
        const context = yield* Effect.context<EventV2Bridge.Service>()
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(answer, answer, fc.string({ maxLength: 120 }), async (first, second, text) => {
              const params = { explanation: `Explanation ${text}`, testingStrategy: `Strategy ${text}` }
              const observed = await Effect.runPromiseWith(context)(
                Effect.gen(function* () {
                  const fiber = yield* tool.execute(params, ctx).pipe(Effect.forkScoped)
                  const firstQuestion = yield* pending(question)
                  expect(firstQuestion.questions[0]?.header).toBe("Error explanation")
                  expect(firstQuestion.questions[0]?.question).toBe(`Error explanation: ${params.explanation}`)
                  expect(firstQuestion.questions[0]?.custom).toBe(false)
                  expect(firstQuestion.questions[0]?.multiple).toBe(false)
                  yield* question.reply({ requestID: firstQuestion.id, answers: first })
                  const next = yield* Effect.raceFirst(
                    Fiber.join(fiber).pipe(Effect.map((result) => ({ stage: "stopped" as const, result }))),
                    pending(question).pipe(Effect.map((request) => ({ stage: "strategy" as const, request }))),
                  )
                  if (next.stage === "stopped") return { result: next.result, strategy: false }
                  expect(next.request.questions[0]?.header).toBe("Testing strategy")
                  expect(next.request.questions[0]?.question).toContain(params.testingStrategy)
                  expect(next.request.questions[0]?.custom).toBe(false)
                  expect(next.request.questions[0]?.multiple).toBe(false)
                  yield* question.reply({ requestID: next.request.id, answers: second })
                  return { result: yield* Fiber.join(fiber), strategy: true }
                }).pipe(Effect.scoped),
              )
              const continued = JSON.stringify(first) === '[["Review testing strategy"]]'
              const requested = continued && JSON.stringify(second) === '[["Show proposed fix"]]'
              expect(observed.strategy).toBe(continued)
              expect(observed.result.metadata.decision).toBe(requested ? "show_fix" : "keep_investigating")
              expect(observed.result.metadata.explanation).toBe(params.explanation)
              if (requested) expect(observed.result.output).toContain("normal permissions")
              if (!requested) expect(observed.result.output).toContain("Do not present or apply the proposed fix")
              expect((await Effect.runPromiseWith(context)(question.list())).length).toBe(0)
            }),
            {
              ...options,
              examples: [
                [[["Keep investigating"]], [["Show proposed fix"]], ""],
                [[["Review testing strategy"]], [["Keep investigating"]], ""],
                [[["Review testing strategy"]], [["Show proposed fix"]], ""],
                [[["Review testing strategy"]], [["Show proposed fix"], []], ""],
              ],
            },
          ),
        )
        console.info("P4B hlabda R3 [invariant]: 300 cases passed")
      }),
    30000,
  )

  // R7: A filename-only change updates references but preserves deterministic
  // fault details and test recommendations. Kind: metamorphic.
  test("R7 [metamorphic]: renaming changes only file references", () => {
    fc.assert(
      // Keep both diagnostic excerpts below the strategy formatter's existing
      // 240-character limit; truncation is not a filename-only transformation.
      fc.property(
        location,
        file,
        fc.integer({ min: -10000, max: 10000 }),
        fc.integer({ min: -10000, max: 10000 }),
        (input, renamed, expected, actual) => {
          fc.pre(input.file !== renamed)
          const context = (path: string) => ({
            tool: "bash",
            exitCode: 1,
            error: `error: expect(received).toBe(expected)\nExpected: ${expected}\nReceived: ${actual}\n    at add (${path}:${input.line}:${input.column})`,
            files: [{ path }],
          })
          const before = ErrorExplanation.create(context(input.file))
          const after = ErrorExplanation.create(context(renamed))
          expect(context(input.file).error.length).toBeLessThanOrEqual(240)
          expect(context(renamed).error.length).toBeLessThanOrEqual(240)
          expect(after.evidence).toContain(`File: ${renamed} line ${input.line}`)
          expect(ErrorExplanation.format(before).replaceAll(input.file, renamed)).toBe(ErrorExplanation.format(after))
          const strategy = (path: string) =>
            TestingStrategy.generate({
              proposedChange: "make add combine its arguments correctly",
              context: context(path),
            })
          expect(strategy(input.file).replaceAll(input.file, renamed)).toBe(strategy(renamed))
        },
      ),
      options,
    )
    console.info("P4B hlabda R7 [metamorphic]: 300 cases passed")
  })
})
