# Dependency-cruiser: static runtime import cycles

Owner: Hamad Labda

The `Runtime import cycles` GitHub Actions job checks `packages/opencode/src` on
pull requests targeting `main`, pushes to `main`, and manual runs. It uses the
pinned `dependency-cruiser` development dependency and the committed Bun lockfile.
A static runtime cycle between different modules makes the job fail.

## Run locally

Use Node.js 24 and the repository's pinned Bun version:

```sh
bun install --frozen-lockfile
bun run verify:dependencies
bun run check:dependencies
```

The verification command creates temporary TypeScript modules under the scanned
source directory, uses the production configuration, and removes the fixtures in
a `finally` block. Run it before the full scan, as the workflow does. Do not run
the verification and full scan concurrently in the same checkout.

## Scope and configuration

- `.dependency-cruiser.cjs` includes `packages/opencode/src`, keeping other
  workspaces and external dependencies outside this first check.
- `tsconfig.dependency-cruiser.json` extends the application's TypeScript config
  and supplies an explicit `baseUrl` for the scanner's resolver. This resolves
  `@/` imports without changing the application's own compiler settings.
- Type-only imports erased during TypeScript compilation are removed before
  cycle detection.
- Lazy `import()` edges are excluded from the graph. The gate checks static
  module dependencies; it does not claim to detect dynamic-import deadlocks or
  all possible runtime import problems.
- Same-file edges are allowed because this repository intentionally uses
  `export * as Foo from "./foo"` inside `foo.ts`. Cycles between different
  self-reexporting modules still fail.
- Generated directories (`generated`, `__generated__`) and `*.gen.*` modules are
  excluded. Handwritten source is not allowlisted to suppress violations.

## Verification and evidence

The eight verification cases cover an acyclic graph, a two-module static cycle,
a three-module cycle using `@/` aliases, an erased type-only edge, a lazy import,
a static cycle alongside a lazy import, an intentional self-reexport, and a
static cycle between self-reexporting modules. Cycle cases must return a nonzero
CLI exit and name `no-runtime-import-cycles`.

The successful local output is recorded in
[`dependency-cruiser-evidence.txt`](./dependency-cruiser-evidence.txt).
Each workflow run also uploads the verification output and repository scan as
the `dependency-cruiser-evidence` Actions artifact, including output on failure.
The workflow uses `pipefail` so saving logs with `tee` cannot hide a failed check.

## Changes from the P3A design

The source scope remains `packages/opencode/src`. The first alias regression test
revealed that reading the original tsconfig alone did not resolve `@/` imports
correctly. The scanner-only tsconfig fixes that; an unresolved alias can no longer
silently make the cycle regression pass.

After resolving aliases, an unrestricted scan reported 17 cycles, all containing
at least one lazy dynamic import. The gate therefore focuses on **static runtime
import cycles**, excluding dynamic edges before analysis. The full static scan
passes without modifying application code or adding a baseline of ignored
violations. This scope adjustment is narrower than checking every runtime import
edge and should be retained in the shared design document.

This PR adds the check and its evidence. Making the job a required branch check
and ensuring deployment waits for all teammates' checks are shared pipeline
integration tasks. A separate push workflow does not automatically wait for this
job; the deployment owner must explicitly connect them before the final group
pipeline run. This change does not alter deployment or branch protection.

## Upkeep

Keep the dependency version pinned, review resolver changes alongside the
application's tsconfig, and maintain the verification cases when module
conventions change. Address new static cycles instead of excluding individual
handwritten modules to make the job green. Review generated-file exclusions as
the project structure changes.

Tool documentation: <https://github.com/sverweij/dependency-cruiser>.
