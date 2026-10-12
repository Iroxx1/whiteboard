// Bundles the server into a single ESM file so the runtime image needs no node_modules.
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  // Some bundled dependencies are CommonJS and call require().
  banner: {
    js: "import { createRequire as __wbCreateRequire } from 'node:module'; const require = __wbCreateRequire(import.meta.url);",
  },
}

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' })
await build({ ...common, entryPoints: ['src/healthcheck.ts'], outfile: 'dist/healthcheck.js', sourcemap: false })
