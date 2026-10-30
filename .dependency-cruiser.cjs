const path = require("node:path")

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-runtime-import-cycles",
      severity: "error",
      comment: "Static runtime imports between different OpenCode modules must not form a cycle.",
      from: { path: "^(.+)$" },
      to: {
        circular: true,
        // OpenCode deliberately uses `export * as Foo from './foo'` in foo.ts.
        pathNot: "^$1$",
      },
    },
  ],
  options: {
    includeOnly: "^packages/opencode/src/",
    exclude: {
      path: "(^|/)(generated|__generated__)/|\\.gen\\.[cm]?[jt]sx?$",
      // Lazy imports are outside the static module-initialization graph.
      dynamic: true,
    },
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: path.join(__dirname, "tsconfig.dependency-cruiser.json") },
    // Remove erased type-only edges before finding cycles, rather than hiding findings afterward.
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      conditionNames: ["bun", "browser", "import", "default"],
      exportsFields: ["exports"],
    },
  },
}
