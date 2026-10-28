import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const cli = path.join(root, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs")

test("accepts acyclic runtime imports", () => {
  const result = scan({
    "a.ts": 'import { value } from "./b"; export const answer = value + 1',
    "b.ts": "export const value = 41",
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /2 modules/)
})

test("rejects a runtime cycle with a nonzero CLI exit", () => {
  const result = scan({
    "a.ts": 'import { b } from "./b"; export const a = () => b()',
    "b.ts": 'import { a } from "./a"; export const b = () => a()',
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /no-runtime-import-cycles/)
})

test("resolves TypeScript aliases and rejects a three-module cycle", () => {
  const result = scan({
    "a.ts": 'import { b } from "@/fixture/b"; export const a = () => b()',
    "b.ts": 'import { c } from "./c"; export const b = () => c()',
    "c.ts": 'import { a } from "@/fixture/a"; export const c = () => a()',
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /no-runtime-import-cycles/)
})

test("accepts a cycle broken by an erased type-only import", () => {
  const result = scan({
    "a.ts": 'import type { B } from "./b"; export type A = { value: B }; export const a = 1',
    "b.ts": 'import { a } from "./a"; export type B = number; export const b = a + 1',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /2 modules/)
})

test("accepts a loop closed only by a lazy dynamic import", () => {
  const result = scan({
    "a.ts": 'export const a = () => import("./b")',
    "b.ts": 'import { a } from "./a"; export const b = () => a()',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /2 modules/)
})

test("a dynamic import does not hide a separate static cycle", () => {
  const result = scan({
    "a.ts": 'import { b } from "./b"; export const a = () => b(); export const lazy = () => import("./c")',
    "b.ts": 'import { a } from "./a"; export const b = () => a()',
    "c.ts": 'import { a } from "./a"; export const c = () => a()',
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /no-runtime-import-cycles/)
})

test("accepts the repository's intentional namespace self-reexport", () => {
  const result = scan({
    "a.ts": 'export const value = 1; export * as A from "./a"',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /1 modules/)
})

test("still rejects runtime cycles when the modules self-reexport", () => {
  const result = scan({
    "a.ts": 'import { b } from "./b"; export const a = () => b(); export * as A from "./a"',
    "b.ts": 'import { a } from "./a"; export const b = () => a(); export * as B from "./b"',
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /no-runtime-import-cycles/)
})

function scan(files) {
  // Use the production config and @/ alias, without adding permanent broken source.
  const dir = mkdtempSync(path.join(root, "packages/opencode/src/dependency-cruiser-check-"))
  try {
    Object.entries(files).forEach(([name, source]) => {
      writeFileSync(path.join(dir, name), source.replaceAll("@/fixture/", `@/${path.basename(dir)}/`))
    })
    const result = spawnSync(
      process.execPath,
      [cli, "--config", ".dependency-cruiser.cjs", "--output-type", "err", path.relative(root, dir)],
      { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
    )
    assert.ifError(result.error)
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
