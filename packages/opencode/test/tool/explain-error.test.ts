import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { ExplainErrorTool } from "../../src/tool/explain-error"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

const request = { info: { role: "user" }, parts: [{ type: "text", text: "Get the tests passing" }] }

const failure = (error: string) => ({
  info: { role: "assistant" },
  parts: [{ type: "tool", tool: "shell", state: { status: "error", error, input: { command: "bun test" } } }],
})

const explain = (error: string | undefined, messages: readonly object[]) =>
  Effect.gen(function* () {
    const info = yield* ExplainErrorTool
    const tool = yield* info.init()
    return yield* tool.execute(
      { error },
      {
        sessionID: SessionID.make("ses_explain"),
        messageID: MessageID.make("msg_explain"),
        agent: "build",
        abort: AbortSignal.any([]),
        messages: messages as SessionV1.WithParts[],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      },
    )
  })

describe("tool.explain_error", () => {
  it.instance("explains the latest failure using only history up to it, with no fix", () =>
    Effect.gen(function* () {
      const latest = failure("error: expect(received).toBe(4)\n    at add (/repo/src/math.test.ts:8:18)")
      const later = { info: { role: "user" }, parts: [{ type: "text", text: "Now rename the button" }] }
      const result = yield* explain(undefined, [request, failure("ENOENT: old.ts"), latest, later])
      const evidence = result.output.slice(0, result.output.indexOf("## How to explain this to the student"))

      expect(evidence).toContain("The `shell` step `bun test` failed while working on: Get the tests passing.")
      expect(evidence).toContain("- File: /repo/src/math.test.ts line 8\n- Function: add")
      expect(evidence).not.toContain("old.ts")
      expect(evidence).not.toContain("rename the button")
      expect(evidence).not.toMatch(/fix/i)
      expect(result.output).toContain("- Do not include, suggest, or apply a fix.")
      expect(result.metadata).toMatchObject({ found: true, confidence: "high" })
    }),
  )

  it.instance("avoids certainty for unclear errors and asks when nothing failed", () =>
    Effect.gen(function* () {
      const unclear = yield* explain("Widget exploded", [request])
      const nothing = yield* explain(undefined, [request])

      expect(unclear.output).toContain("Confidence: low\n")
      expect(unclear.output).toContain("Missing: which file failed")
      expect(nothing.metadata).toMatchObject({ found: false })
    }),
  )
})
