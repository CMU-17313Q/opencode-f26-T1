export interface Context {
  tool?: string
  error?: string
  output?: string
  input?: Record<string, unknown>
  exitCode?: number
  task?: string
  files: { path: string; text?: string }[]
}

/** Collect a failed tool part and history up to that failure, oldest first.
 * File source text is supplied context, not necessarily the file's contents.
 */
export function collect(part: unknown, messages: readonly unknown[] = []): Context | undefined {
  if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)) return
  const state = part.state
  const metadata = isRecord(state.metadata) ? state.metadata : {}
  const exitCode = typeof metadata.exit === "number" && Number.isInteger(metadata.exit) ? metadata.exit : undefined
  if (
    state.status !== "error" &&
    !(part.tool === "shell" && state.status === "completed" && exitCode !== undefined && exitCode !== 0)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export * as ErrorContext from "./error-context"
