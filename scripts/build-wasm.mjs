import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryRoot, 'packages/upspa-js/wasm-pkg');
const temporaryOutputDirectory = resolve(repositoryRoot, 'packages/upspa-js/.wasm-pkg-build');

function findExecutable(root, filename) {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findExecutable(candidate, filename);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return candidate;
    }
  }
  return undefined;
}

const bundledWasmPack = process.platform === 'win32'
  ? findExecutable(resolve(repositoryRoot, '.local-tools/wasm-pack'), 'wasm-pack.exe')
  : undefined;
const wasmPack = process.env.WASM_PACK_BIN || bundledWasmPack || 'wasm-pack';
const buildEnvironment = { ...process.env };

if (process.platform === 'win32' && !buildEnvironment.RUSTUP_TOOLCHAIN) {
  const hasMsvcLinker = spawnSync('where.exe', ['link.exe'], { stdio: 'ignore' }).status === 0;
  const hasGnuToolchain = spawnSync(
    'rustup',
    ['run', 'stable-x86_64-pc-windows-gnu', 'rustc', '-V'],
    { stdio: 'ignore' },
  ).status === 0;
  if (!hasMsvcLinker && hasGnuToolchain) {
    buildEnvironment.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu';
  }
}

rmSync(temporaryOutputDirectory, { force: true, recursive: true });

const result = spawnSync(
  wasmPack,
  [
    'build',
    'crates/upspa-wasm',
    '--target',
    'web',
    '--out-dir',
    '../../packages/upspa-js/.wasm-pkg-build',
    '--release',
  ],
  { cwd: repositoryRoot, env: buildEnvironment, stdio: 'inherit' },
);

if (result.error) {
  rmSync(temporaryOutputDirectory, { force: true, recursive: true });
  console.error(`Unable to start ${wasmPack}: ${result.error.message}`);
  console.error('Install wasm-pack from https://rustwasm.github.io/wasm-pack/installer/ or set WASM_PACK_BIN.');
  process.exit(1);
}

if (result.status !== 0) {
  rmSync(temporaryOutputDirectory, { force: true, recursive: true });
  console.error('The previous generated WASM package, if any, was left unchanged.');
  process.exit(result.status ?? 1);
}

rmSync(outputDirectory, { force: true, recursive: true });
renameSync(temporaryOutputDirectory, outputDirectory);
