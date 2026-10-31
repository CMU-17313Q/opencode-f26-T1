import { resolve } from "node:path"

const severity = { low: 0, moderate: 1, high: 2, critical: 3 }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected a nonempty string")
  return value
}

function finding(value: unknown, name: string) {
  if (!record(value)) throw new Error(`Invalid advisory for ${name}`)
  if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0) throw new Error("Invalid advisory ID")
  const level = string(value.severity)
  if (!Object.hasOwn(severity, level)) throw new Error(`Unknown severity: ${level}`)
  const url = string(value.url)
  if (!/^https:\/\/github\.com\/advisories\/GHSA-[\w-]+$/.test(url)) throw new Error("Invalid advisory URL")
  return {
    package: string(name),
    id: value.id as number,
    url,
    vulnerable_versions: string(value.vulnerable_versions),
    severity: level as keyof typeof severity,
  }
}

export function versions(lock: unknown, name: string) {
  if (!record(lock) || !record(lock.packages)) throw new Error("Invalid Bun lockfile packages")
  const result = [
    ...new Set(
      Object.values(lock.packages).flatMap((value) =>
        Array.isArray(value) && typeof value[0] === "string" && value[0].startsWith(`${name}@`) ? [value[0]] : [],
      ),
    ),
  ].sort()
  if (!result.length) throw new Error(`No lockfile resolution for ${name}`)
  return result
}

export function checkAudit(
  output: string,
  errors: string,
  exit: number,
  lock: unknown,
  baseline: unknown,
  today: string,
) {
  const stderr = errors
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.trim())
  if (stderr.some((line) => line && !/^bun audit v[\w.+-]+ \([a-f\d]+\)$/.test(line))) {
    throw new Error("Audit wrote unexpected stderr; see bun-audit-errors.txt")
  }
  if (exit !== 0 && exit !== 1) throw new Error(`Audit process failed with exit ${exit}`)
  const report: unknown = JSON.parse(output)
  if (!record(report)) throw new Error("Audit returned an invalid report")
  const findings = Object.entries(report).flatMap(([name, values]) => {
    if (!Array.isArray(values)) throw new Error(`Invalid advisory list for ${name}`)
    return values.map((value) => finding(value, name))
  })
  if (exit !== Number(findings.length > 0)) throw new Error("Audit exit status does not match its report")
  if (!record(baseline) || baseline.schemaVersion !== 1 || !Array.isArray(baseline.findings)) {
    throw new Error("Invalid audit baseline")
  }
  string(baseline.owner)
  string(baseline.reason)
  const expires = string(baseline.expires)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || new Date(`${expires}T00:00:00Z`).toISOString().slice(0, 10) !== expires) {
    throw new Error("Invalid baseline expiry date")
  }
  if (today >= expires) throw new Error(`Baseline expired on ${expires}; review the remaining findings`)
  const approved = new Set(
    baseline.findings.map((value) => {
      if (!record(value) || !Array.isArray(value.versions) || !value.versions.length)
        throw new Error("Invalid baseline entry")
      const entry = finding(value, string(value.package))
      if (severity[entry.severity] < severity.high)
        throw new Error("Baseline may only contain high or critical entries")
      const resolved = [...new Set(value.versions.map(string))].sort()
      return JSON.stringify({ ...entry, versions: resolved })
    }),
  )
  const current = findings
    .filter((entry) => severity[entry.severity] >= severity.high)
    .map((entry) => ({
      ...entry,
      versions: versions(lock, entry.package),
    }))
  const unexpected = current.filter((entry) => !approved.has(JSON.stringify(entry)))
  return {
    status: unexpected.length ? "FAIL" : "PASS",
    meaning: "No high or critical findings outside the temporary baseline",
    owner: baseline.owner,
    expires,
    totalAdvisoryEntries: findings.length,
    highOrCriticalEntries: current.length,
    inheritedEntries: current.length - unexpected.length,
    obsoleteBaselineEntries: [...approved].filter((key) => !current.some((entry) => JSON.stringify(entry) === key))
      .length,
    unexpected,
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..")
  const audit = Bun.spawn([process.execPath, "audit", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [output, errors, exit] = await Promise.all([
    new Response(audit.stdout).text(),
    new Response(audit.stderr).text(),
    audit.exited,
  ])
  await Bun.write(resolve(root, "bun-audit-results.json"), output)
  await Bun.write(resolve(root, "bun-audit-errors.txt"), errors)
  const result = checkAudit(
    output,
    errors,
    exit,
    Bun.JSONC.parse(await Bun.file(resolve(root, "bun.lock")).text()),
    await Bun.file(resolve(root, ".github/bun-audit-baseline.json")).json(),
    new Date().toISOString().slice(0, 10),
  )
  await Bun.write(resolve(root, "bun-audit-summary.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result, null, 2))
  if (result.unexpected.length) process.exitCode = 1
}
