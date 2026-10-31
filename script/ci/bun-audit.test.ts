import { expect, test } from "bun:test"
import { checkAudit } from "./bun-audit"

const advisory = {
  id: 123,
  url: "https://github.com/advisories/GHSA-abcd-efgh-ijkl",
  severity: "high",
  vulnerable_versions: "<2.0.0",
}
const lock = { packages: { example: ["example@1.0.0"] } }
const baseline = {
  schemaVersion: 1,
  owner: "akkubais",
  reason: "Temporary inherited finding pending remediation",
  expires: "2026-11-14",
  findings: [{ package: "example", ...advisory, versions: ["example@1.0.0"] }],
}
const report = { example: [advisory] }
const today = "2026-10-31"

test("reports inherited vulnerabilities while passing only the approved snapshot", () => {
  const result = checkAudit(JSON.stringify(report), "bun audit v1.3.14 (0d9b296a)\n", 1, lock, baseline, today)
  expect(result.status).toBe("PASS")
  expect(result.inheritedEntries).toBe(1)
  expect(result.totalAdvisoryEntries).toBe(1)
})

test("rejects new high findings and severity escalation", () => {
  for (const changed of [
    { ...advisory, id: 124 },
    { ...advisory, severity: "critical" },
  ]) {
    expect(checkAudit(JSON.stringify({ example: [changed] }), "", 1, lock, baseline, today).status).toBe("FAIL")
  }
})

test("rejects changed installed versions even for the same advisory", () => {
  const changed = { packages: { example: ["example@1.1.0"] } }
  expect(checkAudit(JSON.stringify(report), "", 1, changed, baseline, today).status).toBe("FAIL")
})

test("keeps new low and moderate findings visible without blocking", () => {
  for (const severity of ["low", "moderate"]) {
    const result = checkAudit(JSON.stringify({ example: [{ ...advisory, severity }] }), "", 1, lock, baseline, today)
    expect(result.status).toBe("PASS")
    expect(result.totalAdvisoryEntries).toBe(1)
    expect(result.highOrCriticalEntries).toBe(0)
  }
})

test("allows removed findings and identifies obsolete baseline entries", () => {
  const result = checkAudit("{}", "", 0, lock, baseline, today)
  expect(result.status).toBe("PASS")
  expect(result.obsoleteBaselineEntries).toBe(1)
})

test("fails expired entries on the expiry date", () => {
  expect(() => checkAudit(JSON.stringify(report), "", 1, lock, baseline, "2026-11-14")).toThrow("expired")
})

test("fails malformed reports, unknown severities, and error responses", () => {
  for (const output of [
    "<html>error</html>",
    "[]",
    '{"error":"unavailable"}',
    JSON.stringify({ example: [{ ...advisory, severity: "unknown" }] }),
    JSON.stringify({ example: [{ ...advisory, severity: "__proto__" }] }),
  ]) {
    expect(() => checkAudit(output, "", 1, lock, baseline, today)).toThrow()
  }
})

test("fails network errors, empty failure reports, and mismatched statuses", () => {
  expect(() => checkAudit("{}", "error: connection failed", 1, lock, baseline, today)).toThrow()
  expect(() => checkAudit("{}", "", 1, lock, baseline, today)).toThrow()
  expect(() => checkAudit(JSON.stringify(report), "", 0, lock, baseline, today)).toThrow()
  expect(() => checkAudit(JSON.stringify(report), "", 2, lock, baseline, today)).toThrow()
})

test("fails invalid baseline metadata and unmapped packages", () => {
  expect(() => checkAudit(JSON.stringify(report), "", 1, lock, { ...baseline, expires: "2026-02-30" }, today)).toThrow()
  expect(() => checkAudit(JSON.stringify(report), "", 1, { packages: {} }, baseline, today)).toThrow(
    "No lockfile resolution",
  )
})
