import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedModule = resolve(repositoryRoot, 'packages/upspa-js/wasm-pkg/upspa_wasm.js');

if (!existsSync(generatedModule)) {
  console.error('Missing generated WASM bindings. Run `pnpm build:wasm` from the repository root.');
  process.exit(1);
}
