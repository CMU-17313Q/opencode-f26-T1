import type { ErrorContext } from "./error-context"

export type Confidence = "high" | "medium" | "low"

export interface Explanation {
  summary: string
  hint?: string
  confidence: Confidence
  evidence: string[]
  missing: string[]
}

const hints: readonly (readonly [RegExp, string])[] = [
  [/cannot find module|enoent|no such file|not found/i, "A module, file, or folder the code needed was missing."],
  [/cannot read propert|is not a function/i, "A value was undefined, null, or the wrong type when it was used."],
  [/is not defined|cannot find name/i, "The code uses a name that was never declared or imported."],
  [/is not assignable|error TS\d+/i, "A value of one type is used where a different type is expected."],
  [/syntaxerror|unexpected token/i, "The code is not valid syntax, so it could not be parsed."],
  [/expect\(|assertionerror|\d+ fail/i, "A test ran, but the result did not match what the test expected."],
]

const guidance: readonly string[] = [
  "Start with the likely cause, in simple language a beginner can follow.",
  "Use only the evidence above and code you have read. Name the relevant files, functions, and error lines.",
  "Treat the hint as a starting point and check it against the code.",
  "If confidence is low or information is missing, say you are not sure. Never state a guess as fact.",
  "Do not include, suggest, or apply a fix.",
]

export function create(context: ErrorContext.Context): Explanation {
  const text = [context.error, context.output].filter((value) => value?.trim()).join("\n")
  const hint = hints.find(([pattern]) => pattern.test(text))?.[1]

  const locations = [...text.matchAll(/(\/?(?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,4})(?::(\d+)|\((\d+),\d+\))/gi)]
  const files = new Set([
    ...locations.map((match) => `${match[1]} line ${match[2] ?? match[3]}`),
    ...context.files.map((file) => file.path),
  ])
  const functions = new Set([...text.matchAll(/^\s*at (?:async )?([\w$.]+) \(/gm)].map((match) => match[1]))
  const firstError = text.split("\n").find((line) => /error|fail|exception/i.test(line))

  return {
    summary: summarize(context),
    hint,
    confidence: !hint ? "low" : locations.length ? "high" : "medium",
    evidence: [
      ...[...files].map((file) => `File: ${file}`),
      ...[...functions].map((name) => `Function: ${name}`),
      ...(firstError ? [`Error output: ${shorten(firstError)}`] : []),
    ],
    missing: [
      ...(text ? [] : ["the error message or output"]),
      ...(files.size ? [] : ["which file failed"]),
      ...(context.task ? [] : ["what the student was trying to do"]),
    ],
  }
}

export function format(explanation: Explanation): string {
  return [
    "## Error evidence",
    `What happened: ${explanation.summary}`,
    ...(explanation.hint ? [`Hint: ${explanation.hint}`] : []),
    `Confidence: ${explanation.confidence}`,
    ...explanation.evidence.map((item) => `- ${item}`),
    ...(explanation.missing.length ? [`Missing: ${explanation.missing.join(", ")}`] : []),
    "",
    "## How to explain this to the student",
    ...guidance.map((item) => `- ${item}`),
  ].join("\n")
}

function summarize(context: ErrorContext.Context): string {
  const command = typeof context.input?.command === "string" ? ` \`${shorten(context.input.command)}\`` : ""
  const exit = context.exitCode !== undefined ? ` with exit code ${context.exitCode}` : ""
  const task = context.task ? ` while working on: ${shorten(context.task)}` : ""
  return `The ${context.tool ? `\`${context.tool}\`` : "last"} step${command} failed${exit}${task}.`
}

function shorten(value: string): string {
  const text = value.trim().replace(/\s+/g, " ")
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

export * as ErrorExplanation from "./error-explanation"
