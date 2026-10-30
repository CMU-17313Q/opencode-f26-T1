import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { ErrorContext } from "../../src/session/error-context"

const seed = Number(process.env.FAST_CHECK_SEED ?? Date.now() | 0)
if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) {
  throw new Error("FAST_CHECK_SEED must be a signed 32-bit integer")
}
const options = { numRuns: 500, seed, verbose: true }
const text = fc.string({ maxLength: 100 })
const path = fc.string({ minLength: 1, maxLength: 60 })
const nonzero = fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 1 }))
const failure = fc.record({
  type: fc.constant("tool"),
  tool: fc.constantFrom("bash", "read", "write"),
  state: fc.record({
    status: fc.constant("error"),
    error: text,
    output: fc.option(text, { nil: undefined }),
    input: fc.record({ filePath: path, command: text, extra: fc.jsonValue() }),
    metadata: fc.record({ exit: nonzero, output: text }),
  }),
})

console.info(`fast-check error-context: seed=${seed}, numRuns=${options.numRuns} per property`)

describe("error context properties", () => {
  test("preserves explicit failures and prefers full output over metadata output", () => {
    fc.assert(
      fc.property(failure, (part) => {
        expect(ErrorContext.collect(part)).toMatchObject({
          tool: part.tool,
          error: part.state.error,
          output: part.state.output ?? part.state.metadata.output,
          input: part.state.input,
          exitCode: part.state.metadata.exit,
          files: [{ path: part.state.input.filePath }],
        })
      }),
      options,
    )
  })

  test("captures completed shell calls for every generated nonzero integer exit", () => {
    fc.assert(
      fc.property(nonzero, text, (exit, output) => {
        expect(
          ErrorContext.collect({
            type: "tool",
            tool: "bash",
            state: { status: "completed", output, metadata: { exit } },
          }),
        ).toMatchObject({ tool: "bash", exitCode: exit, output })
      }),
      options,
    )
  })

  test("ignores unfinished tools, successful shells, and completed non-shell tools", () => {
    fc.assert(
      fc.property(nonzero, fc.constantFrom("pending", "running"), text, (exit, status, output) => {
        const part = { type: "tool", tool: "bash", state: { status, output, metadata: { exit } } }
        expect(ErrorContext.collect(part)).toBeUndefined()
        expect(
          ErrorContext.collect({ ...part, state: { ...part.state, status: "completed", metadata: { exit: 0 } } }),
        ).toBeUndefined()
        expect(
          ErrorContext.collect({ ...part, tool: "read", state: { ...part.state, status: "completed" } }),
        ).toBeUndefined()
      }),
      options,
    )
  })

  test("does not infer shell failure from invalid exit metadata", () => {
    fc.assert(
      fc.property(fc.oneof(text, fc.constantFrom(undefined, null, NaN, Infinity, -Infinity, 1.5, {}, [])), (exit) => {
        expect(
          ErrorContext.collect({ type: "tool", tool: "bash", state: { status: "completed", metadata: { exit } } }),
        ).toBeUndefined()
      }),
      options,
    )
  })

  test("ignores interrupted errors regardless of their error details", () => {
    fc.assert(
      fc.property(failure, (part) => {
        expect(
          ErrorContext.collect({
            ...part,
            state: { ...part.state, metadata: { ...part.state.metadata, interrupted: true } },
          }),
        ).toBeUndefined()
      }),
      options,
    )
  })

  test("uses the latest user context and excludes synthetic and ignored text", () => {
    fc.assert(
      fc.property(
        fc.array(
          text.map((value) => `task:${value}`),
          { maxLength: 12 },
        ),
        fc.array(fc.record({ path, text, type: fc.constantFrom("file", "symbol") }), { maxLength: 12 }),
        text,
        (tasks, files, hidden) => {
          const messages = [
            { info: { role: "user" }, parts: [{ type: "text", text: "old task" }] },
            {
              info: { role: "user" },
              parts: [
                ...tasks.map((value) => ({ type: "text", text: value })),
                { type: "text", text: hidden, synthetic: true },
                { type: "text", text: hidden, ignored: true },
                ...files.map((file) => ({
                  type: "file",
                  source: { type: file.type, path: file.path, text: { value: file.text } },
                })),
              ],
            },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "assistant reply" }] },
          ]
          const before = structuredClone(messages)
          expect(ErrorContext.collect({ type: "tool", state: { status: "error" } }, messages)).toMatchObject({
            task: tasks.length ? tasks.join("\n") : undefined,
            files: files.map((file) => ({ path: file.path, text: file.text })),
          })
          expect(messages).toEqual(before)
        },
      ),
      options,
    )
  })

  test("adds the input file once and preserves existing file context", () => {
    fc.assert(
      fc.property(path, text, fc.boolean(), (file, source, same) => {
        const input = same ? file : `${file}/other`
        const result = ErrorContext.collect({ type: "tool", state: { status: "error", input: { filePath: input } } }, [
          {
            info: { role: "user" },
            parts: [{ type: "file", source: { type: "file", path: file, text: { value: source } } }],
          },
        ])
        expect(result?.files).toEqual(
          same ? [{ path: file, text: source }] : [{ path: file, text: source }, { path: input }],
        )
      }),
      options,
    )
  })

  test("latest selects the last failure without borrowing context from later messages", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ task: text, error: text }), { minLength: 1, maxLength: 12 }), (entries) => {
        const messages = entries.flatMap((entry) => [
          { info: { role: "user" }, parts: [{ type: "text", text: `task:${entry.task}` }] },
          {
            info: { role: "assistant" },
            parts: [{ type: "tool", tool: "read", state: { status: "error", error: entry.error } }],
          },
        ])
        const tail = [
          { info: { role: "user" }, parts: [{ type: "text", text: "future task" }] },
          {
            info: { role: "assistant" },
            parts: [{ type: "tool", tool: "bash", state: { status: "completed", metadata: { exit: 0 } } }],
          },
          {
            info: { role: "assistant" },
            parts: [{ type: "tool", state: { status: "error", metadata: { interrupted: true } } }],
          },
        ]
        const last = entries[entries.length - 1]!
        expect(ErrorContext.latest([...messages, ...tail])).toMatchObject({
          error: last.error,
          task: `task:${last.task}`,
        })
      }),
      options,
    )
  })

  test("a nonblank pasted error takes precedence over generated tool failures", () => {
    fc.assert(
      fc.property(fc.array(failure, { maxLength: 12 }), text, (parts, error) => {
        const pasted = `pasted:${error}`
        expect(ErrorContext.latest([{ parts }], pasted)).toMatchObject({ error: pasted })
      }),
      options,
    )
  })

  test("handles arbitrary JSON parts and histories without throwing or mutating inputs", () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), failure), fc.array(fc.jsonValue(), { maxLength: 12 }), (part, messages) => {
        const before = structuredClone({ part, messages })
        ErrorContext.collect(part, messages)
        expect({ part, messages }).toEqual(before)
      }),
      options,
    )
  })
})
