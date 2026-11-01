// Coverage gate for the guided-debugging feature.
// Fails if any core feature module drops below the line-coverage threshold.
// Gates on the statically-imported session modules (deterministically measured);
// the thin tool wrappers are reported for information only, since they are
// loaded dynamically through the tool registry and are not always instrumented.
import { readFileSync } from "node:fs"

const THRESHOLD = 90
const GATED = [
  "src/session/error-context.ts",
  "src/session/error-explanation.ts",
  "src/session/testing-strategy.ts",
]
const REPORTED = [
  "src/tool/explain-error.ts",
  "src/tool/testing-strategy.ts",
  "src/tool/guided-debug.ts",
]

const rows = new Map()
for (const row of readFileSync(process.argv[2] ?? "coverage.txt", "utf8").split("\n")) {
  const cols = row.split("|")
  if (cols.length < 3) continue
  const file = cols[0].trim()
  const lines = Number(cols[2].trim())
  if (file.startsWith("src/") && Number.isFinite(lines)) rows.set(file, lines)
}

const failures = []
console.log("Gated feature modules:")
for (const file of GATED) {
  const lines = rows.get(file)
  if (lines === undefined) {
    failures.push(`${file}: missing from coverage report`)
    console.log(`  MISSING  ${file}`)
    continue
  }
  console.log(`  ${(lines >= THRESHOLD ? "ok " : "LOW")}  ${file} - ${lines.toFixed(2)}% lines`)
  if (lines < THRESHOLD) failures.push(`${file}: ${lines.toFixed(2)}% < ${THRESHOLD}%`)
}
console.log("Reported (not gated):")
for (const file of REPORTED) {
  const lines = rows.get(file)
  console.log(`  ${lines === undefined ? "(not measured this run)" : lines.toFixed(2) + "% lines"}  ${file}`)
}

if (failures.length) {
  console.error(`\nCoverage gate FAILED:\n- ${failures.join("\n- ")}`)
  process.exit(1)
}
console.log(`\nCoverage gate PASSED: all ${GATED.length} core feature modules >= ${THRESHOLD}% lines.`)
