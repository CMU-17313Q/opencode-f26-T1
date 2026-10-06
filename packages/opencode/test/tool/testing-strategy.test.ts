import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestingStrategyTool } from "../../src/tool/testing-strategy"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

const request = { info: { role: "user" }, parts: [{ type: "text", text: "Get the tests passing" }] }

const failure = (error: string) => ({
  info: { role: "assistant" },
  parts: [{ type: "tool", tool: "shell", state: { status: "error", error, input: { command: "bun test" } } }],
})

const strategy = (params: object, messages: readonly object[]) =>
  Effect.gen(function* () {
    const info = yield* TestingStrategyTool
    const tool = yield* info.init()

    return yield* tool.execute(params as never, {
      sessionID: SessionID.make("ses_strategy"),
      messageID: MessageID.make("msg_strategy"),
      agent: "build",
      abort: AbortSignal.any([]),
      messages: messages as SessionV1.WithParts[],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    })
  })

describe("tool.testing_strategy", () => {
  it.instance("builds a strategy for the latest failure and keeps run tests apart from recommendations", () =>
    Effect.gen(function* () {
      const result = yield* strategy(
        {
          proposedChange: "return the sum instead of the difference",
          executed: [{ name: "bun test", result: "failed", evidence: "2 fail, 1 pass" }],
        },
        [request, failure("ENOENT: old.ts"), failure("error: expect(received).toBe(5)")],
      )

      expect(result.output).toContain("expect(received).toBe(5)")
      expect(result.output).not.toContain("old.ts")
      expect(result.output).toContain("### Tests run\n- bun test: failed. Evidence: 2 fail, 1 pass")
      expect(result.output).toContain("### Recommended tests (not yet run)")
      expect(result.metadata).toMatchObject({ found: true })
    }),
  )

  it.instance("never claims a test passed without evidence", () =>
    Effect.gen(function* () {
      const result = yield* strategy(
        { proposedChange: "return the sum", executed: [{ name: "bun test", result: "passed", evidence: "  " }] },
        [request, failure("error: expect(received).toBe(5)")],
      )

      expect(result.output).toContain("No test runs with evidence were provided.")
      expect(result.output).not.toContain("bun test: passed")
    }),
  )

  it.instance("uses a pasted error, and still works when nothing failed", () =>
    Effect.gen(function* () {
      const pasted = yield* strategy({ proposedChange: "fix the import", error: "Cannot find module './utils'" }, [
        request,
      ])
      const none = yield* strategy({ proposedChange: "fix the import" }, [request])

      expect(pasted.output).toContain("Cannot find module './utils'")
      expect(pasted.metadata).toMatchObject({ found: true })
      expect(none.output).toContain("### Recommended tests (not yet run)")
      expect(none.metadata).toMatchObject({ found: false })
    }),
  )
})
