// Bundles the server into a single ESM file. Native modules stay external; the Docker image ships
// them via `pnpm deploy` (see infra/docker/Dockerfile).
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  external: ['better-sqlite3', '@node-rs/argon2'],
  // Some bundled dependencies are CommonJS and call require().
  banner: {
    js: "import { createRequire as __wbCreateRequire } from 'node:module'; const require = __wbCreateRequire(import.meta.url);",
  },
}

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' })
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', sourcemap: false })
await build({ ...common, entryPoints: ['src/healthcheck.ts'], outfile: 'dist/healthcheck.js', sourcemap: false })
