import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {buildSourcePackage} from './source-package.mjs';
import {renderFormatReference} from './format-docs.mjs';

const root = resolve(import.meta.dirname, '..');

const rawTemplate = await readFile(resolve(root, 'src/template.html'), 'utf8');
const packageInfo = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lockInfo = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
if (lockInfo.version !== packageInfo.version || lockInfo.packages[''].version !== packageInfo.version || packageInfo.license !== 'MIT') {
  throw new Error('Package and lock versions must match, and the application license must be MIT.');
}
const versionMarker = '__LAMJACRAFT_VERSION__';
if (!/^\d+\.\d+\.\d+$/.test(packageInfo.version) || !rawTemplate.includes(versionMarker)) {
  throw new Error('LamjaCraft version or template version marker is missing/invalid');
}
const template = rawTemplate.replaceAll(versionMarker, packageInfo.version);
for (const config of ['tsconfig.json', 'tsconfig.edge-feature-worker.json', 'tsconfig.native-open-worker.json']) {
  const tsc = spawnSync('tsc', ['-p', resolve(root, config)], { cwd: root, encoding: 'utf8' });
  if (tsc.status !== 0) {
    process.stderr.write(tsc.stdout || '');
    process.stderr.write(tsc.stderr || '');
    process.exit(tsc.status ?? 1);
  }
}


const js = await readFile(resolve(root, 'build/app.js'), 'utf8');
const edgeFeatureWorkerJs = await readFile(resolve(root, 'build/edge-feature-worker.js'), 'utf8');
const workerRuntimeJs = edgeFeatureWorkerJs.trim();
await writeFile(resolve(root, 'build/modeling-worker-bundle.js'), workerRuntimeJs);
const nativeOpenWorkerJs = await readFile(resolve(root, 'build/native-open-worker.js'), 'utf8');
const runtimeJs = `const NATIVE_OPEN_WORKER_SOURCE=${JSON.stringify(nativeOpenWorkerJs.trim())};\nconst EDGE_FEATURE_WORKER_SOURCE=${JSON.stringify(workerRuntimeJs)};\n${js.trim()}`;
const bundleMarker = '/*__LAMJACRAFT_3D_BUNDLE__*/';
if (!template.includes(bundleMarker)) {
  throw new Error('Bundle marker missing from src/template.html');
}
const logoMarker = '__LAMJACRAFT_LOGO_DATA_URL__';
if (!template.includes(logoMarker)) {
  throw new Error('Logo marker missing from src/template.html');
}
const logo = await readFile(resolve(root, 'src/assets/lamjacraft-logo.png'));
const logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;

await mkdir(resolve(root, 'dist'), { recursive: true });

const source = await buildSourcePackage(root, packageInfo);
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const formatReference = await readFile(resolve(root, 'docs/NATIVE_FILE_FORMAT.md'), 'utf8');
const replacements = {
  '__LAMJACRAFT_FILE_FORMAT_HTML__': renderFormatReference(formatReference),
  '__LAMJACRAFT_MIT_LICENSE_HTML__': escapeHtml(await readFile(resolve(root, 'LICENSE'), 'utf8')),
  '__LAMJACRAFT_FONT_LICENSE_HTML__': escapeHtml(await readFile(resolve(root, 'src/assets/DejaVuSans-LICENSE.txt'), 'utf8')),
  '__LAMJACRAFT_SOURCE_FILENAME__': source.fileName,
  '__LAMJACRAFT_SOURCE_BYTES__': String(source.bytes.length),
  '__LAMJACRAFT_SOURCE_SHA256__': source.sha256,
  '__LAMJACRAFT_SOURCE_SIZE__': `${(source.bytes.length / 1024 / 1024).toFixed(2)} MB`,
  '__LAMJACRAFT_SOURCE_ZIP_BASE64__': source.bytes.toString('base64'),
};
let readableHtml = template.replaceAll(logoMarker, logoDataUrl).replace(bundleMarker, runtimeJs);
for (const [marker, value] of Object.entries(replacements)) {
  if (!rawTemplate.includes(marker)) throw new Error(`Required source/license template marker is missing: ${marker}`);
  readableHtml = readableHtml.replaceAll(marker, value);
}
if (/__LAMJACRAFT_[A-Z_]+__/.test(readableHtml)) throw new Error('The generated HTML contains an unresolved build marker.');
await writeFile(resolve(root, 'dist', source.fileName), source.bytes);
await writeFile(resolve(root, 'dist/LamjaCraft-3D.html'), readableHtml);
await writeFile(resolve(root, 'dist/index.html'), readableHtml);
await copyFile(resolve(root, 'public/sitemap.xml'), resolve(root, 'dist/sitemap.xml'));

// Remove the obsolete generated distribution when upgrading an existing checkout.
await rm(resolve(root, 'dist/LamjaCraft-3D-compact.html'), { force: true });

console.log(`Built dist/LamjaCraft-3D.html + dist/index.html (${Buffer.byteLength(readableHtml).toLocaleString()} bytes each)`);
console.log('Copied dist/sitemap.xml');

console.log(`Embedded ${source.fileName}: ${source.fileCount} source files, ${source.bytes.length.toLocaleString()} ZIP bytes, SHA-256 ${source.sha256}`);
