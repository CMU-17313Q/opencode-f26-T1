export type Case = "normal" | "edge" | "failure"

export interface ErrorContext {
  tool?: string
  error?: string
  output?: string
  input?: Record<string, unknown>
  exitCode?: number
  task?: string
  files?: readonly { path: string; text?: string }[]
}

export interface ExecutedTest {
  name: string
  result: "passed" | "failed"
  evidence: string
}

export interface Input {
  proposedChange: string
  context?: ErrorContext
  executed?: readonly ExecutedTest[]
}

export interface Recommendation {
  case: Case
  test: string
  reason: string
}

export interface Strategy {
  connection: string
  executed: ExecutedTest[]
  recommended: Recommendation[]
}

export function create(input: Input): Strategy {
  const change = summarize(input.proposedChange) ?? "the proposed change"
  const failure = summarize(input.context?.error) ?? summarize(input.context?.output)
  const paths =
    input.context?.files
      ?.map((file) => file.path.trim())
      .filter(Boolean)
      .slice(0, 3) ?? []
  const target = paths.length ? paths.join(", ") : (summarize(input.context?.task) ?? "the affected workflow")
  const operation = input.context?.tool ? `${input.context.tool} operation` : "original operation"
  const code = input.context?.exitCode
  const observed = failure ? `${failure}${code === undefined ? "" : ` (exit ${code})`}` : undefined
  const edge =
    paths.length > 0 ||
    Boolean(input.context?.task?.trim()) ||
    Boolean(input.context?.input && Object.keys(input.context.input).length)

  return {
    connection: observed
      ? `Validate the proposed change (${change}) against the observed ${operation} failure: ${observed}.`
      : `Validate the proposed change (${change}) in ${target}.`,
    executed:
      input.executed
        ?.filter((test) => test.name.trim() && test.evidence.trim())
        .map((test) => ({
          name: test.name.trim(),
          result: test.result,
          evidence: test.evidence.trim(),
        })) ?? [],
    recommended: [
      {
        case: "normal" as const,
        test: `Exercise the expected path for ${target} with representative valid input after applying the proposed change: ${change}.`,
        reason: "Confirms the intended behavior works, rather than only making the original error disappear.",
      },
      ...(edge
        ? [
            {
              case: "edge" as const,
              test: `Exercise boundary conditions around ${target}, including empty, missing, and minimal valid input where the interface permits them.`,
              reason:
                "Checks that the change behaves predictably at nearby input boundaries and does not introduce a regression.",
            },
          ]
        : []),
      ...(observed
        ? [
            {
              case: "failure" as const,
              test: `Reproduce the ${operation} failure (${observed}) and repeat the same operation after the change; also verify genuinely invalid input still reports a controlled failure.`,
              reason:
                "Connects the test to the reported problem and ensures the change fixes the intended case without turning real failures into false successes.",
            },
          ]
        : []),
    ],
  }
}

export function format(strategy: Strategy) {
  const executed = strategy.executed.length
    ? strategy.executed.map((test) => `- ${test.name}: ${test.result}. Evidence: ${test.evidence}`)
    : ["- No test runs with evidence were provided."]
  const recommended = strategy.recommended.map((item) => `- ${label(item.case)}: ${item.test}\n  Why: ${item.reason}`)

  return [
    "## Testing strategy",
    "",
    strategy.connection,
    "",
    "### Tests run",
    ...executed,
    "",
    "### Recommended tests (not yet run)",
    ...recommended,
  ].join("\n")
}

export function generate(input: Input) {
  return format(create(input))
}

function summarize(value: string | undefined) {
  if (!value?.trim()) return
  const text = value.trim().replace(/\s+/g, " ")
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

function label(value: Case) {
  return `${value[0]!.toUpperCase()}${value.slice(1)} case`
}

export * as TestingStrategy from "./testing-strategy"
