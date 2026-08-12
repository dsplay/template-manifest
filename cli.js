#!/usr/bin/env node
import path from 'node:path';
import { generateManifest } from './core.js';

function parseArgs(argv) {
  const options = { src: 'src', dsplayData: 'public/dsplay-data.js', out: 'build' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src') options.src = argv[(i += 1)];
    else if (arg === '--dsplay-data') options.dsplayData = argv[(i += 1)];
    else if (arg === '--out') options.out = argv[(i += 1)];
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(1);
    }
  }
  return options;
}

const { src, dsplayData, out } = parseArgs(process.argv.slice(2));
const cwd = process.cwd();

const { variables } = generateManifest({
  srcDir: path.resolve(cwd, src),
  dsplayDataPath: path.resolve(cwd, dsplayData),
  outDir: path.resolve(cwd, out),
});

process.stdout.write(`dsplay-scan-template: found ${variables.length} template variable(s), wrote manifest to ${path.resolve(cwd, out)}\n`);
