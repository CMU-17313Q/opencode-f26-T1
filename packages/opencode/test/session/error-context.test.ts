import { describe, expect, test } from "bun:test"
import { ErrorContext } from "../../src/session/error-context"

describe("error context", () => {
  test("captures a tool error and its input", () => {
    expect(
      ErrorContext.collect({
        type: "tool",
        tool: "read",
        state: {
          status: "error",
          error: "File not found",
          input: { filePath: "src/missing.ts" },
        },
      }),
    ).toMatchObject({
      tool: "read",
      error: "File not found",
      input: { filePath: "src/missing.ts" },
      files: [{ path: "src/missing.ts" }],
    })
  })

  test("captures completed shell failures and prefers full output", () => {
    expect(
      ErrorContext.collect({
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "bun test" },
          output: "Full failure output",
          metadata: { exit: 1, output: "Preview" },
        },
      }),
    ).toMatchObject({ tool: "bash", exitCode: 1, output: "Full failure output", input: { command: "bun test" } })
  })

  test("preserves available output on tool errors", () => {
    expect(
      ErrorContext.collect({
        type: "tool",
        tool: "bash",
        state: {
          status: "error",
          metadata: { exit: 2, output: "Partial output" },
        },
      }),
    ).toMatchObject({ exitCode: 2, output: "Partial output" })
  })

  test.each([0, undefined, null, "1", NaN, Infinity, 1.5])(
    "does not infer failure from invalid or successful exit %s",
    (exit) => {
      expect(
        ErrorContext.collect({ type: "tool", tool: "bash", state: { status: "completed", metadata: { exit } } }),
      ).toBeUndefined()
    },
  )

  test.each(["pending", "running"])("ignores %s tools", (status) => {
    expect(
      ErrorContext.collect({ type: "tool", tool: "bash", state: { status, metadata: { exit: 1 } } }),
    ).toBeUndefined()
  })

  test("ignores interrupted tool errors", () => {
    expect(
      ErrorContext.collect({
        type: "tool",
        tool: "bash",
        state: {
          status: "error",
          error: "Tool execution aborted",
          metadata: { interrupted: true, output: "Partial output" },
        },
      }),
    ).toBeUndefined()
  })

  test("does not interpret another tool's exit metadata as shell failure", () => {
    expect(
      ErrorContext.collect({ type: "tool", tool: "read", state: { status: "completed", metadata: { exit: 1 } } }),
    ).toBeUndefined()
  })

  test.each([undefined, null, {}, { type: "tool" }, { type: "tool", state: null }])(
    "handles incomplete parts: %j",
    (part) => {
      expect(ErrorContext.collect(part)).toBeUndefined()
    },
  )

  test("ignores an array instead of a tool part", () => {
    expect(ErrorContext.collect([])).toBeUndefined()
  })

  test("retains an explicit failure with missing details", () => {
    expect(ErrorContext.collect({ type: "tool", state: { status: "error", input: [], metadata: null } })).toEqual({
      tool: undefined,
      error: undefined,
      output: undefined,
      input: undefined,
      exitCode: undefined,
      task: undefined,
      files: [],
    })
  })

  test("uses only the latest user task and its file context", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Old task" }] },
      {
        info: { role: "user" },
        parts: [
          { type: "text", text: "Fix this function" },
          { type: "text", text: "Keep its API" },
          { type: "text", text: "Hidden", synthetic: true },
          { type: "text", text: "Ignored", ignored: true },
          { type: "file", source: { type: "symbol", path: "src/app.ts", text: { value: "function run() {}" } } },
          { type: "file", source: null },
        ],
      },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Assistant reply" }] },
      null,
    ]
    const part = { type: "tool", state: { status: "error", input: { filePath: "src/app.ts" } } }
    const before = JSON.stringify({ part, messages })
    expect(ErrorContext.collect(part, messages)).toMatchObject({
      task: "Fix this function\nKeep its API",
      files: [{ path: "src/app.ts", text: "function run() {}" }],
    })
    expect(JSON.stringify({ part, messages })).toBe(before)
  })

  test("does not fall back to an older task when the latest user message has no text", () => {
    expect(
      ErrorContext.collect({ type: "tool", state: { status: "error" } }, [
        { info: { role: "user" }, parts: [{ type: "text", text: "Old task" }] },
        { info: { role: "user" }, parts: null },
      ])?.task,
    ).toBeUndefined()
  })
})
