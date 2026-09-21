import { describe, expect, test } from "bun:test"
import { TestingStrategy } from "../../src/session/testing-strategy"

describe("session.testing-strategy", () => {
  test("connects normal, edge, and failure recommendations to the proposed parser change", () => {
    const strategy = TestingStrategy.create({
      proposedChange: "reject unmatched closing brackets before building the syntax tree",
      context: {
        tool: "shell",
        error: "SyntaxError: unexpected ]",
        exitCode: 1,
        task: "Fix the parser without changing valid expressions",
        input: { command: "bun test test/parser.test.ts" },
        files: [{ path: "src/parser.ts" }],
      },
      executed: [
        {
          name: "bun test test/parser.test.ts",
          result: "failed",
          evidence: "1 test failed with SyntaxError: unexpected ]",
        },
      ],
    })

    expect(strategy.connection).toContain("reject unmatched closing brackets")
    expect(strategy.connection).toContain("SyntaxError: unexpected ]")
    expect(strategy.executed).toEqual([
      {
        name: "bun test test/parser.test.ts",
        result: "failed",
        evidence: "1 test failed with SyntaxError: unexpected ]",
      },
    ])
    expect(strategy.recommended.map((item) => item.case)).toEqual(["normal", "edge", "failure"])
    expect(strategy.recommended.every((item) => item.test.includes("src/parser.ts") || item.case === "failure")).toBe(
      true,
    )
    expect(strategy.recommended.every((item) => item.reason.length > 0)).toBe(true)
    expect(strategy.recommended.find((item) => item.case === "failure")?.test).toContain("SyntaxError: unexpected ]")
  })

  test("separates evidence-backed test runs from recommendations", () => {
    const output = TestingStrategy.generate({
      proposedChange: "preserve the last valid configuration",
      context: { task: "Handle an empty configuration file", files: [{ path: "src/config.ts" }] },
      executed: [{ name: "bun test", result: "passed", evidence: "   " }],
    })

    expect(output).toContain("### Tests run\n- No test runs with evidence were provided.")
    expect(output).toContain("### Recommended tests (not yet run)")
    expect(output).toContain("- Normal case:")
    expect(output).toContain("- Edge case:")
    expect(output).not.toContain("- Failure case:")
    expect(output).not.toContain("bun test: passed")
  })

  test("does not invent edge or failure cases without supporting context", () => {
    const strategy = TestingStrategy.create({ proposedChange: "rename the displayed heading" })

    expect(strategy.connection).toBe(
      "Validate the proposed change (rename the displayed heading) in the affected workflow.",
    )
    expect(strategy.executed).toEqual([])
    expect(strategy.recommended.map((item) => item.case)).toEqual(["normal"])
  })

  test("keeps multiline error output concise and readable", () => {
    const output = TestingStrategy.generate({
      proposedChange: "return a useful message for missing files",
      context: { tool: "read", output: "File not found\n  at src/load.ts:12" },
    })

    expect(output).toContain("File not found at src/load.ts:12")
    expect(output).not.toContain("undefined")
  })
})
