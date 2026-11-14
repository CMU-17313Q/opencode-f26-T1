import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { ErrorContext } from "../../src/session/error-context"
import { ErrorExplanation } from "../../src/session/error-explanation"

const seed = Number(process.env.FAST_CHECK_SEED ?? 17313)
const options = { numRuns: 200, seed, verbose: true }
console.info(`P4B bgisagew: seed=${seed}, numRuns=${options.numRuns} per property`)

// Printed after each property so the CI log shows it ran under --only-failures.
const report = (label: string) => console.info(`P4B bgisagew ${label}: ${options.numRuns} cases passed`)

type Location = { file: string; line: number; column: number }

type Failure = {
  message: string
  recognized: boolean
  ambiguous: boolean
  style: "frame" | "tsc" | "file" | "none"
  fn: string
  at: Location
}

// Paths stay within what the location parser on main supports; spaces and Unicode are hlabda's PR #40.
const name = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,9}$/)
const file = fc
  .tuple(fc.boolean(), fc.array(name, { minLength: 1, maxLength: 3 }), fc.constantFrom("ts", "tsx", "js", "mjs"))
  .map(([absolute, parts, extension]) => `${absolute ? "/repo/" : ""}src/${parts.join("/")}.${extension}`)

// Small lines make near-collisions like "line 1" and "line 12" common.
const location = fc.record({
  file,
  line: fc.oneof(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 21, max: 99999 })),
  column: fc.integer({ min: 1, max: 999 }),
})

const message = fc.oneof(
  name.map((value) => `TypeError: Cannot read properties of undefined (reading '${value}')`),
  name.map((value) => `TypeError: ${value} is not a function`),
  name.map((value) => `ReferenceError: ${value} is not defined`),
  fc.constantFrom("}", ")", "<", "export").map((token) => `SyntaxError: Unexpected token '${token}'`),
  fc.integer().map((value) => `error: expect(received).toBe(expected)\n\nExpected: 4\nReceived: ${value}`),
)

// Words that match no error kind the tool knows.
const nonsense = fc
  .array(fc.constantFrom("Widget", "gizmo", "sprocket", "flux", "exploded", "overheated", "wobbled", "jammed"), {
    minLength: 1,
    maxLength: 5,
  })
  .map((words) => words.join(" "))

const frameOrNone = fc.constantFrom(...(["frame", "none"] as const))

const runtime = (style: fc.Arbitrary<"frame" | "none">) =>
  fc.record({ message, style, fn: name, at: location }).map((item) => ({ ...item, recognized: true, ambiguous: false }))

const unknown = fc
  .record({ message: nonsense, style: frameOrNone, fn: name, at: location })
  .map((item) => ({ ...item, recognized: false, ambiguous: false }))

const diagnostic = fc.record({ fn: name, at: location }).map((item) => ({
  ...item,
  message: "error TS2322: Type 'string' is not assignable to type 'number'.",
  recognized: true,
  ambiguous: false,
  style: "tsc" as const,
}))

// Unresolved imports as Bun, Node, tsc, and Vite report them, for packages, scoped packages, subpaths, and relative paths.
const moduleName = fc.oneof(
  name,
  fc.tuple(name, name).map(([scope, pkg]) => `@${scope}/${pkg}`),
  fc.tuple(name, name).map(([pkg, path]) => `${pkg}/${path}`),
  fc.tuple(name, name).map(([dir, path]) => `./${dir}/${path}`),
)

const formats = {
  bun: (module: string, from: string) => ({
    message: `error: Cannot find module '${module}' from '${from}'`,
    style: "none" as const,
  }),
  node: (module: string, from: string) => ({
    message: `Error: Cannot find module '${module}'\nRequire stack:\n- ${from}`,
    style: "none" as const,
  }),
  tsc: (module: string) => ({
    message: `error TS2307: Cannot find module '${module}' or its corresponding type declarations.`,
    style: "tsc" as const,
  }),
  vite: (module: string, from: string) => ({
    message: `[vite] Internal server error: Failed to resolve import "${module}" from "${from}". Does the file exist?`,
    style: "none" as const,
  }),
  located: (module: string, from: string) => ({ ...formats.vite(module, from), style: "file" as const }),
}

const unresolvedIn = (format: fc.Arbitrary<(module: string, from: string) => Pick<Failure, "message" | "style">>) =>
  fc.record({ module: moduleName, format, fn: name, at: location }).map((item) => ({
    ...item.format(item.module, item.at.file),
    recognized: true,
    ambiguous: true,
    fn: item.fn,
    at: item.at,
  }))
const unresolved = unresolvedIn(fc.constantFrom(...Object.values(formats)))

const failure = fc.oneof(runtime(frameOrNone), unknown, diagnostic, unresolved)

// Recognized failures that report a location, built that way instead of filtered.
const placed = fc.oneof(
  runtime(fc.constant("frame" as const)),
  diagnostic,
  unresolvedIn(fc.constantFrom(formats.tsc, formats.located)),
)

const text = (item: Failure) => {
  const at = `${item.at.file}:${item.at.line}:${item.at.column}`
  if (item.style === "frame") return `${item.message}\n    at ${item.fn} (${at})`
  if (item.style === "file") return `${item.message}\n  File: ${at}`
  if (item.style === "tsc") return `${item.at.file}(${item.at.line},${item.at.column}): ${item.message}`
  return item.message
}

const command = fc
  .tuple(
    fc.constantFrom("bun test", "bun run build", "bun typecheck", "npm test", "npx tsc --noEmit"),
    fc.option(file, { nil: undefined }),
  )
  .map(([base, target]) => (target ? `${base} ${target}` : base))

const task = fc.constantFrom(
  "Get the tests passing",
  "Add a quantity field to the cart",
  "Build the app",
  "Why does checkout crash?",
  "Make the login page load",
)

const user = (...parts: object[]) => ({ info: { role: "user" }, parts })
const assistant = (...parts: object[]) => ({ info: { role: "assistant" }, parts })
const request = (body: string) => user({ type: "text", text: body })
const shell = (run: string, state: object) =>
  assistant({ type: "tool", tool: "bash", state: { input: { command: run }, ...state } })

// The shell tool reports a failure as a tool error or as a completed run with a nonzero exit.
const failed = (run: string, output: string, exit: boolean) =>
  exit
    ? shell(run, { status: "completed", output, metadata: { exit: 1, output } })
    : shell(run, { status: "error", error: output })
const succeeded = (run: string) =>
  shell(run, { status: "completed", output: "Done.", metadata: { exit: 0, output: "Done." } })

// The same steps the explain_error tool runs.
const explain = (messages: readonly { parts: readonly unknown[] }[], pasted?: string) => {
  const context = ErrorContext.latest(messages, pasted)
  if (!context) throw new Error("explain_error found no failure")
  const explanation = ErrorExplanation.create(context)
  return { explanation, output: ErrorExplanation.format(explanation) }
}

const evidence = (output: string) => output.slice(0, output.indexOf("## How to explain this to the student"))
const lines = (output: string, prefix: string) => output.split("\n").filter((item) => item.startsWith(prefix))

const located = (body: string, fn: string, at: Location): Failure => ({
  message: body,
  recognized: true,
  ambiguous: false,
  style: "frame",
  fn,
  at,
})
const math = located("error: expect(received).toBe(4)", "add", { file: "/repo/src/math.test.ts", line: 8, column: 18 })
const cart = located("TypeError: Cannot read properties of undefined (reading 'total')", "getTotal", {
  file: "src/cart.ts",
  line: 12,
  column: 5,
})
const lodsh: Failure = {
  ...formats.bun("lodsh", "/repo/src/index.ts"),
  recognized: true,
  ambiguous: true,
  fn: "main",
  at: { file: "/repo/src/index.ts", line: 1, column: 1 },
}
const widget: Failure = { ...lodsh, message: "Widget exploded", recognized: false, ambiguous: false }

describe("P4B bgisagew: explain_error properties", () => {
  // R2: The explain_error result never proposes a fix. It tells the agent not to include one and to
  // end by asking whether the student wants help with a fix.
  // Kind: invariant
  test("R2 [invariant]: the explain_error result never proposes a fix", () => {
    fc.assert(
      fc.property(failure, command, task, fc.boolean(), (item, run, goal, exit) => {
        const result = explain([request(goal), failed(run, text(item), exit)])

        expect(result.output).toContain("- Do not include, suggest, or apply a fix.")
        expect(result.output.trimEnd()).toEndWith("End by asking whether the student wants help working out a fix.")
        expect(ErrorExplanation.check(result.output).fix).toBe(false)
      }),
      options,
    )
    report("R2 [invariant] tool result")
  })

  // R2: The response check flags any reply that proposes a fix.
  // Kind: invariant
  test("R2 [invariant]: the response check flags every reply that proposes a fix", () => {
    const sentence = fc.oneof(
      fc.tuple(name, name).map(([value, fn]) => `The value ${value} was undefined when ${fn} ran.`),
      location.map((at) => `The error comes from ${at.file} line ${at.line}.`),
      name.map((fn) => `${fn} expected a number but received a string.`),
      fc.constant("I am fairly sure, but the stack trace is short."),
    )
    const reply = fc
      .array(sentence, { minLength: 4, maxLength: 4 })
      .map((bodies) =>
        ErrorExplanation.sections.map((section, index) => `### ${section}\n${bodies[index]}`).join("\n\n"),
      )

    // A fix section under a common heading, or a fix sentence inside a section (C-3, O-3).
    const fix = fc.oneof(
      fc
        .tuple(
          fc.constantFrom("Fix", "Proposed fix", "Suggested fix", "The fix", "How to fix it", "Solution"),
          sentence,
        )
        .map(([heading, body]) => `\n\n### ${heading}\n${body}`),
      fc.tuple(name, name).map(([from, to]) => ` To fix this, change ${from} to ${to}.`),
      fc.tuple(name, name).map(([from, to]) => ` Replace ${from} with ${to}.`),
      name.map((value) => ` You can fix it by importing ${value}.`),
      name.map((value) => ` The fix is to rename ${value}.`),
    )

    fc.assert(
      fc.property(reply, fix, (body, addition) => {
        expect(ErrorExplanation.check(body).fix).toBe(false)
        expect(ErrorExplanation.check(`${body}${addition}`).fix).toBe(true)
      }),
      options,
    )
    report("R2 [invariant] response check")
  })

  // R3: The explanation states a confidence level. It is "high" only when the error is recognized and
  // points to a file and line. When information is missing, the explanation says what is missing.
  // Kind: model/oracle
  test("R3 [model/oracle]: confidence and missing information match a model of the failure", () => {
    const model = (item: Failure) =>
      !item.recognized ? "low" : item.style !== "none" && !item.ambiguous ? "high" : "medium"

    fc.assert(
      fc.property(failure, command, task, fc.boolean(), (item, run, goal, exit) => {
        const result = explain([request(goal), failed(run, text(item), exit)])

        expect(result.explanation.confidence).toBe(model(item))
        expect(result.output).toContain(`Confidence: ${model(item)}\n`)
        expect(lines(result.output, "Missing:").join().includes("which file failed")).toBe(item.style === "none")
      }),
      {
        ...options,
        examples: [
          [cart, "bun test", "Get the cart tests passing", false],
          [lodsh, "bun run build", "Build the app", true],
          [widget, "bun test", "Get the tests passing", false],
        ],
      },
    )
    report("R3 [model/oracle]")
  })

  // R4: For a "cannot find module" error, the explanation doesn't claim the package is uninstalled.
  // It gives a misspelled import name or path as an equally likely cause.
  // Kind: invariant
  test("R4 [invariant]: an unresolved import names both causes and is never high confidence", () => {
    fc.assert(
      fc.property(unresolved, command, task, fc.boolean(), (item, run, goal, exit) => {
        const result = explain([request(goal), failed(run, text(item), exit)])
        const hint = lines(result.output, "Hint").join()

        expect(hint).toMatch(/not (be )?installed/)
        expect(hint).toMatch(/misspelled/)
        expect(result.explanation.confidence).not.toBe("high")
      }),
      { ...options, examples: [[lodsh, "bun run build", "Build the app", true]] },
    )
    report("R4 [invariant]")
  })

  // R5: The explanation covers only the most recent failure. Earlier failures, and later messages
  // that are not a passing rerun of the failed command, don't change it.
  // Kind: metamorphic
  test("R5 [metamorphic]: earlier failures and unrelated later messages leave the explanation unchanged", () => {
    const earlier = fc.array(fc.record({ item: failure, run: command, goal: task }), { maxLength: 3 })

    // Chat (C-8, O-8), other passing commands, a passing run of the same command plus a flag, and
    // reruns that are still running or were interrupted.
    const later = fc.array(
      fc.oneof(
        task.map((body) => ({ kind: "chat", body })),
        fc.constantFrom("git status", "ls src", "bun install").map((body) => ({ kind: "other", body })),
        fc.constantFrom("--bail", "--watch").map((body) => ({ kind: "similar", body })),
        fc.constantFrom("pending", "running", "interrupted").map((body) => ({ kind: "rerun", body })),
      ),
      { maxLength: 4 },
    )

    const happen = (event: { kind: string; body: string }, run: string) => {
      if (event.kind === "chat") return request(event.body)
      if (event.kind === "other") return succeeded(event.body)
      if (event.kind === "similar") return succeeded(`${run} ${event.body}`)
      if (event.body === "interrupted")
        return shell(run, { status: "error", error: "Tool execution aborted", metadata: { interrupted: true } })
      return shell(run, { status: event.body })
    }

    fc.assert(
      fc.property(failure, command, task, fc.boolean(), earlier, later, (item, run, goal, exit, before, after) => {
        const history = [request(goal), failed(run, text(item), exit)]
        const busy = [
          ...before.flatMap((past) => [request(past.goal), failed(past.run, text(past.item), false)]),
          ...history,
          ...after.map((event) => happen(event, run)),
        ]

        expect(explain(busy).output).toBe(explain(history).output)
      }),
      {
        ...options,
        examples: [
          [
            math,
            "bun test",
            "Get the tests passing",
            false,
            [
              {
                item: { ...widget, message: "ENOENT: no such file or directory, open 'old.ts'", recognized: true },
                run: "bun run start",
                goal: "Get the tests passing",
              },
            ],
            [{ kind: "chat", body: "Now rename the button" }],
          ],
        ],
      },
    )
    report("R5 [metamorphic]")
  })

  // R6: When the same error happens in a different file or on a different line, the cause stays the
  // same and the location matches the new error.
  // Kind: metamorphic
  test("R6 [metamorphic]: moving an error keeps its cause and reports the new location", () => {
    // Always changes the location, so no case is discarded.
    const move = fc.oneof(
      fc.integer({ min: 1, max: 20 }).map((shift) => (at: Location) => ({ ...at, line: at.line + shift })),
      name.map((folder) => (at: Location) => ({ ...at, file: at.file.replace("src/", `src/${folder}/`) })),
    )

    fc.assert(
      fc.property(placed, move, command, task, fc.boolean(), (item, shift, run, goal, exit) => {
        const at = shift(item.at)
        const before = explain([request(goal), failed(run, text(item), exit)])
        const after = explain([request(goal), failed(run, text({ ...item, at }), exit)])

        expect(lines(after.output, "Hint")).toEqual(lines(before.output, "Hint"))
        expect(after.explanation.confidence).toBe(before.explanation.confidence)
        expect(after.output).toContain(`- File: ${at.file} line ${at.line}\n`)
        expect(after.output).not.toContain(`- File: ${item.at.file} line ${item.at.line}\n`)
      }),
      options,
    )
    report("R6 [metamorphic]")
  })

  // R7: Every file and function listed as evidence comes from the recorded failure: it appears in the
  // failure output, is a file the student attached, or is the file the failed step was working on.
  // Kind: invariant
  test("R7 [invariant]: evidence only lists files and functions from the recorded failure", () => {
    // Named, async, method, library, anonymous, bare, and Node-internal frames (C-9, O-9).
    const frame = fc.oneof(
      fc.tuple(name, location).map(([fn, at]) => `    at ${fn} (${at.file}:${at.line}:${at.column})`),
      fc.tuple(name, location).map(([fn, at]) => `    at async ${fn} (${at.file}:${at.line}:${at.column})`),
      fc
        .tuple(name, name, location)
        .map(([type, fn, at]) => `    at ${type}.${fn} (${at.file}:${at.line}:${at.column})`),
      fc
        .tuple(name, name, location)
        .map(([pkg, fn, at]) => `    at ${fn} (/repo/node_modules/${pkg}/index.js:${at.line}:${at.column})`),
      location.map((at) => `    at Object.<anonymous> (${at.file}:${at.line}:${at.column})`),
      location.map((at) => `    at ${at.file}:${at.line}:${at.column}`),
      fc.constant("    at <anonymous>"),
      fc.constant("    at processTicksAndRejections (node:internal/process/task_queues:95:5)"),
    )
    const trace = fc
      .tuple(fc.oneof(message, nonsense), fc.array(frame, { maxLength: 6 }))
      .map(([head, frames]) => [head, ...frames].join("\n"))
    const step = fc.oneof(
      command.map((run) => ({ tool: "bash", input: { command: run } as Record<string, string> })),
      fc
        .tuple(fc.constantFrom("edit", "write", "read"), file)
        .map(([tool, path]) => ({ tool, input: { filePath: path } as Record<string, string> })),
    )

    fc.assert(
      fc.property(trace, step, fc.array(file, { maxLength: 2 }), task, (output, failing, attached, goal) => {
        const result = explain([
          user(
            { type: "text", text: goal },
            ...attached.map((path) => ({ type: "file", source: { type: "file", path, text: { value: "" } } })),
          ),
          assistant({
            type: "tool",
            tool: failing.tool,
            state: { status: "error", error: output, input: failing.input },
          }),
        ])
        const recorded = (listed: string) => {
          const at = /^(.*) line (\d+)$/.exec(listed)
          if (at) return output.includes(`${at[1]}:${at[2]}`) || output.includes(`${at[1]}(${at[2]},`)
          return attached.includes(listed) || listed === failing.input.filePath
        }

        lines(evidence(result.output), "- File: ").forEach((item) => expect(recorded(item.slice(8))).toBe(true))
        lines(evidence(result.output), "- Function: ").forEach((item) => {
          const fn = item.slice(12)
          expect(output.includes(`at ${fn} (`) || output.includes(`at async ${fn} (`)).toBe(true)
        })
      }),
      options,
    )
    report("R7 [invariant]")
  })

  // R8: If the failed command was rerun and passed, the explanation still covers the earlier failure
  // and also says the latest run passed.
  // Kind: round-trip
  test("R8 [round-trip]: a passing rerun is reported, and failing again restores the first explanation", () => {
    fc.assert(
      fc.property(failure, command, task, fc.boolean(), (item, run, goal, exit) => {
        const history = [request(goal), failed(run, text(item), exit)]
        const first = explain(history).output
        const recovered = explain([...history, succeeded(run)]).output
        const again = explain([...history, succeeded(run), failed(run, text(item), exit)]).output

        evidence(first)
          .split("\n")
          .filter(Boolean)
          .forEach((item) => expect(recovered).toContain(item))
        expect(recovered).toContain("a later run of the same command passed")
        expect(first).not.toContain("a later run of the same command passed")
        expect(again).toBe(first)
      }),
      { ...options, examples: [[math, "bun test", "Get the tests passing", false]] },
    )
    report("R8 [round-trip]")
  })

  // R9: A pasted error gets the same diagnosis as the same error from a command in the session. When
  // no command is known, the explanation says so instead of naming one.
  // Kind: metamorphic
  test("R9 [metamorphic]: a pasted error gets the same diagnosis and names no command", () => {
    fc.assert(
      fc.property(failure, command, task, fc.boolean(), (item, run, goal, exit) => {
        const session = explain([request(goal), failed(run, text(item), exit)]).output
        const pasted = explain([request("Why did this fail?")], text(item)).output

        ;["Hint", "Confidence:", "- File:", "- Function:", "- Error output:"].forEach((prefix) =>
          expect(lines(pasted, prefix)).toEqual(lines(session, prefix)),
        )
        expect(lines(pasted, "What happened").join()).not.toContain("`")
        expect(lines(pasted, "Missing:").join()).toContain("which command was run")
        expect(lines(session, "Missing:").join()).not.toContain("which command was run")
      }),
      { ...options, examples: [[math, "bun test", "Get the tests passing", false]] },
    )
    report("R9 [metamorphic]")
  })
})
