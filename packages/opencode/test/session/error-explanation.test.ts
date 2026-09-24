import { describe, expect, test } from "bun:test"
import { ErrorExplanation } from "../../src/session/error-explanation"

const examples = {
  type: {
    tool: "shell",
    input: { command: "bun typecheck" },
    exitCode: 2,
    output: "src/cart.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    task: "Add a quantity field to the cart",
    files: [],
  },
  module: {
    tool: "shell",
    input: { command: "bun run start" },
    exitCode: 1,
    error: "error: Cannot find module './utils/format' from '/repo/src/index.ts'",
    files: [],
  },
  assertion: {
    tool: "shell",
    input: { command: "bun test" },
    error: "error: expect(received).toBe(expected)\n    at total (/repo/src/cart.test.ts:22:5)",
    task: "Get the cart tests passing",
    files: [{ path: "src/cart.ts" }],
  },
  unclear: { error: "Widget exploded", files: [] },
} satisfies Record<string, Parameters<typeof ErrorExplanation.create>[0]>

const reply = (sections: readonly string[], body = "The likely cause is a missing import.") =>
  sections.map((section) => `### ${section}\n${body}`).join("\n\n")

describe("session.error-explanation", () => {
  test.each(Object.entries(examples))("builds a complete structured response for the %s example", (_, context) => {
    const explanation = ErrorExplanation.create(context)
    const output = ErrorExplanation.format(explanation)

    expect(explanation.summary).toContain("failed")
    expect(["high", "medium", "low"]).toContain(explanation.confidence)
    expect(output).toContain(`Confidence: ${explanation.confidence}`)
    expect(output).toContain(`Confidence is ${explanation.confidence}`)
    ErrorExplanation.sections.forEach((section) => expect(output).toContain(`### ${section}\n`))
    expect(ErrorExplanation.check(output.slice(output.indexOf("## Response format")))).toMatchObject({
      missing: [],
      ordered: true,
    })
  })

  test("reports the cause and where it happened for a located error", () => {
    const explanation = ErrorExplanation.create(examples.type)

    expect(explanation.hint).toBe("A value of one type is used where a different type is expected.")
    expect(explanation.confidence).toBe("high")
    expect(explanation.evidence).toContain("File: src/cart.ts line 14")
    expect(explanation.missing).toEqual([])
  })

  test("asks for uncertainty and names what is missing when confidence is not high", () => {
    const medium = ErrorExplanation.format(
      ErrorExplanation.create({ error: "TypeError: x is not a function", files: [] }),
    )
    const low = ErrorExplanation.format(ErrorExplanation.create(examples.unclear))

    expect(medium).toContain("Confidence is medium")
    expect(medium).toContain("Say which part is a best guess.")
    expect(low).toContain("Say clearly that you are not sure")
    expect(low).toContain("Say what is missing: which file failed, what the student was trying to do.")
  })

  test("keeps the explanation separate from a fix", () => {
    const output = ErrorExplanation.format(ErrorExplanation.create(examples.assertion))

    expect(ErrorExplanation.sections.join(" ")).not.toMatch(/fix/i)
    expect(output).toContain("The explanation and the fix are separate steps: do not add a fix section.")
    expect(output.trimEnd()).toEndWith("End by asking whether the student wants help working out a fix.")
  })

  test("checks replies against the format", () => {
    const sections = ErrorExplanation.sections

    expect(ErrorExplanation.check(reply(sections))).toEqual({ missing: [], ordered: true, fix: false })
    expect(ErrorExplanation.check(reply(sections.slice(0, 2)))).toMatchObject({
      missing: ["Why it happened", "How sure I am"],
    })
    expect(ErrorExplanation.check(reply([...sections].reverse())).ordered).toBe(false)
    expect(ErrorExplanation.check(`${reply(sections)}\n\n### Proposed fix\nImport it.`).fix).toBe(true)
    expect(ErrorExplanation.check(`${reply(sections)}\n\n### Fixture\nA sample cart.`).fix).toBe(false)
    expect(ErrorExplanation.check(reply(sections, "To fix this, change count to Number(count).")).fix).toBe(true)
  })
})
