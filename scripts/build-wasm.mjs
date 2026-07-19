import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryRoot, 'packages/upspa-js/wasm-pkg');
const wasmPack = process.env.WASM_PACK_BIN || 'wasm-pack';

rmSync(outputDirectory, { force: true, recursive: true });

const result = spawnSync(
  wasmPack,
  [
    'build',
    'crates/upspa-wasm',
    '--target',
    'web',
    '--out-dir',
    '../../packages/upspa-js/wasm-pkg',
    '--release',
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

if (result.error) {
  console.error(`Unable to start ${wasmPack}: ${result.error.message}`);
  console.error('Install wasm-pack from https://rustwasm.github.io/wasm-pack/installer/ or set WASM_PACK_BIN.');
  process.exit(1);
}

if (result.status !== 0) process.exit(result.status ?? 1);
