// Bundles the server into a single ESM file. Native modules (better-sqlite3, argon2, sharp) and
// packages that load files or modules at runtime (heic-convert with WebAssembly, file-type) stay
// external, as does grammy (its API calls hung when bundled); the Docker image ships them via
// `pnpm deploy` (see infra/docker/Dockerfile).
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  external: ['better-sqlite3', '@node-rs/argon2', 'sharp', 'heic-convert', 'file-type', 'grammy'],
  // Some bundled dependencies are CommonJS and call require().
  banner: {
    js: "import { createRequire as __wbCreateRequire } from 'node:module'; const require = __wbCreateRequire(import.meta.url);",
  },
}

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' })
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', sourcemap: false })
await build({ ...common, entryPoints: ['src/healthcheck.ts'], outfile: 'dist/healthcheck.js', sourcemap: false })
