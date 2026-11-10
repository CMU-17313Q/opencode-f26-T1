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

// P4B generators deliberately include empty/multiline evidence, distinct execution IDs,
// zero/nonzero exits, errors, interrupted calls, and multiple parts per message.
// Commands are data only: these tests never execute generated shell commands.
const evidence = fc.oneof(text, fc.constantFrom("", "\n", "Error: missing\n  at main.ts:1", "مرحبا"))
const execution = fc.record({
  kind: fc.constantFrom("failed", "error", "success", "running", "interrupted"),
  command: evidence,
  cwd: evidence,
  output: evidence,
  exit: fc.integer({ min: 1, max: 255 }),
})
function tool(entry: ReturnType<typeof execution.generate>["value"], id: number) {
  return {
    type: "tool",
    tool: "bash",
    callID: `call-${id}`,
    state: {
      status:
        entry.kind === "error" || entry.kind === "interrupted"
          ? "error"
          : entry.kind === "running"
            ? "running"
            : "completed",
      input: { command: `run-${id}:${entry.command}`, workdir: `/run-${id}/${entry.cwd}` },
      error: entry.kind === "error" ? entry.output : undefined,
      output: entry.output,
      metadata: { exit: entry.kind === "success" ? 0 : entry.exit, interrupted: entry.kind === "interrupted" },
    },
  }
}

describe("aaljabri P4B requirements", () => {
  // R1: When asked about the latest failure without a pasted error, the collector
  // selects the most recent failed command. Kind: model/oracle.
  test("R1: latest failure agrees with a chronological execution model", () => {
    fc.assert(
      fc.property(fc.array(fc.array(execution, { maxLength: 5 }), { maxLength: 12 }), (groups) => {
        const entries = groups.flat()
        const expected = entries.reduce<number | undefined>(
          (last, entry, index) => (entry.kind === "failed" || entry.kind === "error" ? index : last),
          undefined,
        )
        let index = 0
        const messages = groups.map((group) => ({ parts: group.map((entry) => tool(entry, index++)) }))
        const result = ErrorContext.latest(messages)
        if (expected === undefined) {
          expect(result).toBeUndefined()
          return
        }
        expect(result?.input?.command).toBe(`run-${expected}:${entries[expected]!.command}`)
        expect(result?.input?.workdir).toBe(`/run-${expected}/${entries[expected]!.cwd}`)
      }),
      options,
    )
  })

  // R2: The current failure's command, directory, output, and exit code must
  // come from the same execution. Kind: invariant.
  test("R2: selected failure never mixes execution evidence", () => {
    fc.assert(
      fc.property(fc.array(execution, { minLength: 2, maxLength: 20 }), (entries) => {
        const parts = entries.map((entry, index) => tool({ ...entry, kind: "failed" }, index))
        const last = parts[parts.length - 1]!
        expect(ErrorContext.latest([{ parts }])).toMatchObject({
          input: last.state.input,
          output: last.state.output,
          exitCode: last.state.metadata.exit,
        })
      }),
      options,
    )
  })

  // R3: Adding unrelated chat messages after a failure, with no new tool calls,
  // preserves the selected failure and its collected context. Kind: metamorphic.
  test("R3: unrelated chat preserves the full failure context", () => {
    fc.assert(
      fc.property(
        execution,
        evidence,
        path,
        fc.array(evidence, { minLength: 1, maxLength: 12 }),
        (entry, task, file, tail) => {
          const messages = [
            {
              info: { role: "user" },
              parts: [
                { type: "text", text: `task:${task}` },
                { type: "file", source: { type: "file", path: file, text: { value: task } } },
              ],
            },
            { info: { role: "assistant" }, parts: [tool({ ...entry, kind: "failed" }, 0)] },
          ]
          const before = ErrorContext.latest(messages)
          expect(before).toBeDefined()
          expect(before?.task).toBe(`task:${task}`)
          expect(before?.files).toEqual([{ path: file, text: task }])
          const unrelated = tail.map((value) => ({ info: { role: "user" }, parts: [{ type: "text", text: value }] }))
          expect(ErrorContext.latest([...messages, ...unrelated])).toEqual(before)
        },
      ),
      options,
    )
  })

  // R4: The collector preserves available command input, working directory,
  // exit code, and error/output for inspection. Kind: invariant.
  test("R4: available execution evidence is preserved exactly", () => {
    fc.assert(
      fc.property(execution, fc.boolean(), fc.boolean(), (entry, error, full) => {
        const part = tool({ ...entry, kind: error ? "error" : "failed" }, 0)
        const input = structuredClone(part.state.input)
        const result = ErrorContext.collect({
          ...part,
          state: {
            ...part.state,
            output: full ? entry.output : undefined,
            metadata: { ...part.state.metadata, output: entry.output },
          },
        })
        expect(result).toMatchObject({ input, exitCode: entry.exit, output: entry.output })
        expect(result?.error).toBe(error ? entry.output : undefined)
        expect(part.state.input).toEqual(input)
      }),
      options,
    )
  })
})
