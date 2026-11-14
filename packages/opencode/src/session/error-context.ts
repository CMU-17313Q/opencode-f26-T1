import { ShellID } from "@/tool/shell/id"
export interface Context {
  tool?: string
  error?: string
  output?: string
  input?: Record<string, unknown>
  exitCode?: number
  task?: string
  files: { path: string; text?: string }[]
  rerunPassed?: boolean
}

/** Collect a failed tool part and history up to that failure, oldest first.
 * File source text is supplied context, not necessarily the file's contents.
 */
export function collect(part: unknown, messages: readonly unknown[] = []): Context | undefined {
  if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)) return
  const state = part.state
  const metadata = isRecord(state.metadata) ? state.metadata : {}
  if (state.status === "error" && metadata.interrupted === true) return
  const exitCode = typeof metadata.exit === "number" && Number.isInteger(metadata.exit) ? metadata.exit : undefined
  if (
    state.status !== "error" &&
    !(part.tool === ShellID.ToolID && state.status === "completed" && exitCode !== undefined && exitCode !== 0)
  )
    return

  const user = messages.findLast(
    (message) => isRecord(message) && isRecord(message.info) && message.info.role === "user",
  )
  const parts = isRecord(user) && Array.isArray(user.parts) ? user.parts.filter(isRecord) : []
  const task = parts
    .filter((item) => item.type === "text" && !item.synthetic && !item.ignored)
    .flatMap((item) => (typeof item.text === "string" && item.text.trim() ? [item.text] : []))
    .join("\n")
  const input = isRecord(state.input) ? state.input : undefined
  const files = parts.flatMap((item) => {
    if (item.type !== "file" || !isRecord(item.source)) return []
    const source = item.source
    if ((source.type !== "file" && source.type !== "symbol") || typeof source.path !== "string") return []
    return [{ path: source.path, text: isRecord(source.text) ? string(source.text.value) : undefined }]
  })
  const path = string(input?.filePath)
  return {
    tool: string(part.tool),
    error: string(state.error),
    output: string(state.output) ?? string(metadata.output),
    input,
    exitCode,
    task: task || undefined,
    files: path && !files.some((file) => file.path === path) ? [...files, { path }] : files,
  }
}

/** Find the pasted error, or else the latest failure in the history, with only the history up to that failure.
 * The only later event it reports is a passing rerun of the same command.
 */
export function latest(messages: readonly { parts: readonly unknown[] }[], pasted?: string) {
  if (pasted?.trim()) return collect({ type: "tool", state: { status: "error", error: pasted } }, messages)
  const runs = messages.flatMap((message, index) =>
    message.parts.map((part) => ({ part, context: collect(part, messages.slice(0, index + 1)) })),
  )
  const index = runs.findLastIndex((run) => run.context !== undefined)
  const context = runs[index]?.context
  if (!context) return
  if (!runs.slice(index + 1).some((run) => reran(runs[index].part, run.part))) return context
  return { ...context, rerunPassed: true }
}

/** A later call of the same tool with the same command that exited 0. */
function reran(failed: unknown, later: unknown) {
  if (!isRecord(failed) || !isRecord(failed.state) || !isRecord(later) || !isRecord(later.state)) return false
  const command = isRecord(failed.state.input) ? string(failed.state.input.command) : undefined
  const input = isRecord(later.state.input) ? later.state.input : {}
  const metadata = isRecord(later.state.metadata) ? later.state.metadata : {}
  return (
    command !== undefined &&
    later.type === "tool" &&
    later.tool === failed.tool &&
    later.state.status === "completed" &&
    input.command === command &&
    metadata.exit === 0
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export * as ErrorContext from "./error-context"
