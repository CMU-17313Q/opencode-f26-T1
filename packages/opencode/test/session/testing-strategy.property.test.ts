import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { TestingStrategy } from "../../src/session/testing-strategy"

// Vary independent names, source locations and commands. Include the P4A
// examples plus first-line errors and lines up to 10,000. Restricted identifiers
// avoid accidental Markdown headings while still exercising many distinct cases.
const token = fc.stringMatching(/^[a-z][a-z0-9]{0,16}$/)
const location = fc.oneof(
  fc.constant("src/parser.ts:12"),
  fc.tuple(token, fc.integer({ min: 1, max: 10000 })).map(([name, line]) => `src/${name}.ts:${line}`),
)
const change = token.map((name) => `handle empty input in ${name} by returning []`)
const options = { numRuns: 200, seed: 17313 }

describe("P4B akkubais: testing-strategy properties", () => {
  // R1: Separate recorded results from suggested tests. Kind: invariant.
  // Absent records and empty/whitespace-only names or evidence must not create
  // a result, regardless of the status supplied by the caller.
  test("R1: no usable run evidence means no reported pass or failure", () => {
    const unusable = fc.array(
      fc.oneof(
        fc.record({
          name: token,
          result: fc.constantFrom("passed" as const, "failed" as const),
          evidence: fc.constantFrom("", " ", "\n\t"),
        }),
        fc.record({
          name: fc.constantFrom("", " ", "\n\t"),
          result: fc.constantFrom("passed" as const, "failed" as const),
          evidence: token,
        }),
      ),
      { maxLength: 8 },
    )
    fc.assert(
      fc.property(change, fc.option(unusable, { nil: undefined }), (proposedChange, executed) => {
        const input = { proposedChange, executed }
        const strategy = TestingStrategy.create(input)
        const output = TestingStrategy.generate(input)
        const results = output.split("### Tests run\n")[1]!.split("### Recommended tests (not yet run)")[0]!
        expect(strategy.executed).toEqual([])
        expect(results.trim()).toBe("- No test runs with evidence were provided.")
        expect(results).not.toMatch(/\b(passed|failed|verified)\b/i)
        expect(output).toContain("### Recommended tests (not yet run)")
        expect(strategy.recommended.map((item) => item.case)).toEqual(["normal", "edge"])
        expect(strategy.recommended.find((item) => item.case === "edge")?.test).toContain(proposedChange)
      }),
      options,
    )
  })

  // R2: Include the test name, location, and command in a reproduction step
  // when provided. Kind: invariant.
  test("R2: reproduction preserves the supplied test, location and command", () => {
    const name = fc.oneof(fc.constant("empty input"), token.map((value) => `test-${value}`))
    const command = fc.oneof(
      fc.constant("bun test test/parser.test.ts"),
      token.map((value) => `bun test test/${value}.test.ts`),
    )
    fc.assert(
      fc.property(change, name, location, command, (proposedChange, name, path, command) => {
        const strategy = TestingStrategy.create({
          proposedChange,
          context: { tool: "shell", error: "empty input crashed", files: [{ path }], input: { command } },
          executed: [{ name, result: "failed", evidence: "empty input crashed" }],
        })
        const reproduction = strategy.recommended.find((item) => item.case === "failure")
        expect(reproduction).toBeDefined()
        expect(reproduction!.test).toContain(name)
        expect(reproduction!.test).toContain(path)
        expect(reproduction!.test).toContain(command)
      }),
      options,
    )
  })

  // R3: Remove the failure result and its reproduction step when the log and
  // error are removed. Kind: round-trip.
  // Add varying logs, exit codes and run records, then remove only the error,
  // log and recorded run. Keep the fix and file context throughout.
  test("R3: adding then removing failure evidence restores the original plan", () => {
    fc.assert(
      fc.property(change, location, token, fc.integer({ min: 1, max: 255 }), (proposedChange, path, marker, exitCode) => {
        const input: TestingStrategy.Input = { proposedChange, context: { files: [{ path }] } }
        const before = TestingStrategy.generate(input)
        const error = `failure-${marker}`
        input.context = {
          ...input.context,
          tool: "shell",
          error,
          output: `log-${marker}`,
          exitCode,
          input: { command: `bun test test/${marker}.test.ts` },
        }
        input.executed = [{ name: `case-${marker}`, result: "failed", evidence: error }]
        const during = TestingStrategy.generate(input)
        expect(during).toContain(`case-${marker}: failed`)
        expect(during).toContain("- Failure case:")
        expect(during).toContain(error)
        delete input.context.error
        delete input.context.output
        delete input.executed
        const after = TestingStrategy.generate(input)
        expect(after).toBe(before)
        expect(after).not.toContain(error)
        expect(after).not.toContain("- Failure case:")
        expect(TestingStrategy.create(input).recommended.map((item) => item.case)).toEqual(["normal", "edge"])
      }),
      options,
    )
  })

  // R7: Identify a known error location and explain why the suggested check
  // matters. Kind: metamorphic.
  // Moving the same failure to another location must change only the location;
  // the explanation must still connect the empty-input check to expected [].
  test("R7: relocating an error preserves the behavior being checked", () => {
    fc.assert(
      fc.property(change, token, fc.integer({ min: 1, max: 10000 }), (proposedChange, name, line) => {
        const first = `src/old-${name}.ts:${line}`
        const second = `src/new-${name}.ts:${line + 1}`
        const input = { proposedChange, context: { error: "empty input crashed", files: [{ path: first }] } }
        const before = TestingStrategy.create(input)
        const after = TestingStrategy.create({ ...input, context: { ...input.context, files: [{ path: second }] } })
        for (const [strategy, path] of [[before, first], [after, second]] as const) {
          const check = strategy.recommended.find((item) => item.case === "failure")!
          expect(check.test).toContain(path)
          expect(check.test).toContain("empty input crashed")
          expect(check.reason).toContain("[]")
          expect(check.reason).toContain(proposedChange)
          expect(check.reason).toMatch(/without.*original error/i)
        }
        expect(TestingStrategy.format(after)).toBe(TestingStrategy.format(before).split(first).join(second))
      }),
      options,
    )
  })
})
