// Property-based tests for Belard Ange Rutayisire's (brutayis) P4B requirements on the
// guided-debugging error explanation. Requirement IDs and wording match
// traceability/brutayis.md.
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { ErrorExplanation } from "../../src/session/error-explanation"

type Context = Parameters<typeof ErrorExplanation.create>[0]

const runs = { numRuns: 300 }

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Path segments use the characters real project paths use: letters, digits, "_", "-" and
// inner dots (e.g. "app.config"). Names are kept away from words that the hint table looks
// for, so a hint never comes from the file name instead of the message.
const segment = fc
  .stringMatching(/^[a-z][a-z0-9_-]{0,9}(\.[a-z0-9]{1,5})?$/)
  .filter((name) => !/enoent|error|found|syntax|expect|fail|exception/.test(name))

// Extensions students actually run into, including the longer component-file ones
// (.svelte, .astro) that people building web apps use, not only .ts and .js.
const extension = fc.constantFrom("ts", "tsx", "js", "mjs", "cjs", "json", "vue", "svelte", "astro", "py", "go", "rs")

// Absolute, "./" relative and plain relative paths, one to four folders deep.
const filePath = fc
  .tuple(
    fc.constantFrom("/repo/", "./", "", "/home/student/project/"),
    fc.array(segment, { minLength: 0, maxLength: 3 }),
    segment,
    extension,
  )
  .map(([root, folders, name, ext]) => `${root}${[...folders, `${name}.${ext}`].join("/")}`)

const line = fc.integer({ min: 1, max: 5000 })
const column = fc.integer({ min: 1, max: 200 })

// The three location formats our tools print: Bun/Node stack frames, "file:line:col"
// headers, and tsc's "file(line,col)".
type Location = { path: string; line: number; column: number; style: "stack" | "colon" | "tsc" }
const location: fc.Arbitrary<Location> = fc.record({
  path: filePath,
  line,
  column,
  style: fc.constantFrom("stack", "colon", "tsc"),
})

function place(message: string, at: Location) {
  if (at.style === "stack") return `error: ${message}\n    at run (${at.path}:${at.line}:${at.column})`
  if (at.style === "tsc") return `${at.path}(${at.line},${at.column}): error: ${message}`
  return `${at.path}:${at.line}:${at.column} - error: ${message}`
}

// Recognized error messages, one per entry in the hint table, with the variable parts
// (module names, identifiers, numbers) generated.
const identifier = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,11}$/)
const recognized = fc.oneof(
  identifier.map((name) => `Cannot find module './${name}'`),
  identifier.map((name) => `TypeError: Cannot read properties of undefined (reading '${name}')`),
  identifier.map((name) => `ReferenceError: ${name} is not defined`),
  fc.integer({ min: 1000, max: 9999 }).map((code) => `error TS${code}: Type 'string' is not assignable to type 'number'.`),
  identifier.map((name) => `SyntaxError: Unexpected token '${name}'`),
  fc.integer({ min: 1, max: 99 }).map((count) => `expect(received).toBe(expected)\n${count} fail`),
)

// Failures that match no hint: crashes and signals students see from native code, test
// runners and the OS. Interviewees (C-2, O-4) worried most about these, where a tool is
// tempted to invent a cause. None of them has a file and line.
const unrecognized = fc.oneof(
  fc.constantFrom(
    "Segmentation fault (core dumped)",
    "Killed",
    "Bus error: 10",
    "Abort trap: 6",
    "zsh: illegal hardware instruction  ./a.out",
    "panic: widget exploded",
    "Widget exploded",
    "process exited unexpectedly",
  ),
  fc.integer({ min: 1, max: 255 }).map((code) => `Process terminated with signal ${code}`),
)

// "Not said" includes the empty and whitespace-only tasks a UI sends when the box is left blank.
const blankTask = fc.constantFrom(undefined, "", " ", "   ", "\n", "\t \n")
const realTask = fc.constantFrom(
  "Get the cart tests passing",
  "Add a quantity field to the cart",
  "Fix the login page",
  "Make the build green",
)

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

const where = (at: Location) => `File: ${at.path} line ${at.line}`
const fileLines = (explanation: ErrorExplanation.Explanation) =>
  explanation.evidence.filter((item) => item.startsWith("File: "))

function headings(output: string) {
  const format = output.slice(output.indexOf("## Response format"))
  return [...format.matchAll(/^### (.+)$/gm)].map((match) => match[1])
}

function section(output: string, name: string) {
  const start = output.indexOf(`### ${name}`)
  const rest = output.slice(start + name.length + 4)
  const next = rest.search(/^#{2,3} /m)
  return next === -1 ? rest : rest.slice(0, next)
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("brutayis P4B properties: error explanation", () => {
  // R2: The same kind of error in a different file gets the same four sections, in the
  // same order, with the same hint, but the evidence names the new file and line.
  // Kind: metamorphic
  test("R2 [metamorphic]: moving an error to another file keeps sections and hint, and names the new file", () => {
    fc.assert(
      fc.property(recognized, location, location, fc.constantFrom("output", "error"), (message, first, second, field) => {
        fc.pre(where(first) !== where(second))
        const a = ErrorExplanation.create({ [field]: place(message, first), files: [] } as Context)
        const b = ErrorExplanation.create({ [field]: place(message, second), files: [] } as Context)

        expect(headings(ErrorExplanation.format(a))).toEqual([...ErrorExplanation.sections])
        expect(headings(ErrorExplanation.format(b))).toEqual([...ErrorExplanation.sections])
        expect(b.hint).toBeDefined()
        expect(b.hint).toBe(a.hint)
        expect(b.confidence).toBe(a.confidence)
        expect(fileLines(a)).toEqual([where(first)])
        expect(fileLines(b)).toEqual([where(second)])
      }),
      runs,
    )
  })

  // R3: The explanation finds the failing file and line from the error output, even if the
  // student did not open or attach that file.
  // Kind: model/oracle. The oracle is the generator itself: it knows exactly which
  // locations it printed into the output, independent of the code's parsing regex.
  test("R3 [model/oracle]: every printed file and line is found with no attached files", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(recognized, location), { minLength: 1, maxLength: 4 }), (failures) => {
        const output = failures.map(([message, at]) => place(message, at)).join("\n")
        const explanation = ErrorExplanation.create({ tool: "bash", output, files: [] })
        const expected = [...new Set(failures.map(([, at]) => where(at)))]

        expect(fileLines(explanation)).toEqual(expected)
        expect(explanation.missing).not.toContain("which file failed")
      }),
      runs,
    )
  })

  // R4: When the student has not said what they were trying to do, the explanation says
  // this is missing instead of guessing their goal.
  // Kind: invariant
  test("R4 [invariant]: a missing or blank task is always reported as missing, never guessed", () => {
    fc.assert(
      fc.property(fc.oneof(recognized, unrecognized), fc.option(location, { nil: undefined }), blankTask, realTask, (message, at, blank, task) => {
        const output = at ? place(message, at) : message
        const without = ErrorExplanation.create({ output, task: blank, files: [] })
        const formatted = ErrorExplanation.format(without)

        expect(without.missing).toContain("what the student was trying to do")
        expect(section(formatted, "How sure I am")).toContain("what the student was trying to do")
        expect(without.summary).not.toContain("while working on")

        const given = ErrorExplanation.create({ output, task, files: [] })
        expect(given.missing).not.toContain("what the student was trying to do")
        expect(given.summary).toContain(task)
      }),
      runs,
    )
  })

  // R5: When the error is not recognized, the explanation says it is not sure instead of
  // stating a cause as fact, and lists the error lines it used as evidence.
  // Kind: invariant
  test("R5 [invariant]: an unrecognized error is low confidence and cites its own error line", () => {
    fc.assert(
      fc.property(unrecognized, fc.constantFrom("output", "error"), (message, field) => {
        const explanation = ErrorExplanation.create({ [field]: message, files: [] } as Context)
        const formatted = ErrorExplanation.format(explanation)
        const firstLine = message.split("\n")[0].trim().replace(/\s+/g, " ")

        expect(explanation.hint).toBeUndefined()
        expect(explanation.confidence).toBe("low")
        expect(explanation.evidence).toContain(`Error output: ${firstLine}`)
        expect(section(formatted, "How sure I am")).toContain("not sure")
        expect(section(formatted, "How sure I am")).toContain("what would help")
      }),
      runs,
    )
  })

  // R6: The "Where it happened" section names the file and error line the explanation is
  // based on, so the student can check it, and says so when no location is known.
  // Kind: invariant. Holds in both directions: a location in the output is always named,
  // and with no location nothing is named and the missing location is stated.
  test("R6 [invariant]: a location is named when known and reported missing when not", () => {
    fc.assert(
      fc.property(fc.oneof(recognized, unrecognized), fc.option(location, { nil: undefined }), (message, at) => {
        const explanation = ErrorExplanation.create({ output: at ? place(message, at) : message, files: [] })
        const formatted = ErrorExplanation.format(explanation)

        expect(section(formatted, "Where it happened")).toContain("If none are known, say so")
        if (at) {
          expect(fileLines(explanation)).toEqual([where(at)])
          expect(formatted).toContain(`- ${where(at)}`)
          expect(explanation.missing).not.toContain("which file failed")
        } else {
          expect(fileLines(explanation)).toEqual([])
          expect(explanation.missing).toContain("which file failed")
          expect(formatted).toContain("Missing: ")
        }
      }),
      runs,
    )
  })
})
