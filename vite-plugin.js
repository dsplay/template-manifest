import path from 'node:path';
import { generateManifest } from './core.js';

/**
 * Vite plugin that generates `template-variables.json` + `template-example-data.json` into
 * the build output directory once the build finishes - see `generateManifest` for details.
 * @param {{srcDir?: string, dsplayDataPath?: string}} [options] - Paths relative to the
 * resolved Vite root. Defaults match this ecosystem's convention: `src` and `public/dsplay-data.js`.
 */
export default function templateManifestPlugin(options = {}) {
  const { srcDir = 'src', dsplayDataPath = 'public/dsplay-data.js' } = options;
  let config;
  let done = false;

  return {
    name: 'dsplay-template-manifest',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    closeBundle() {
      if (done) return;
      done = true;

      generateManifest({
        srcDir: path.resolve(config.root, srcDir),
        dsplayDataPath: path.resolve(config.root, dsplayDataPath),
        outDir: path.resolve(config.root, config.build.outDir),
      });
    },
  };
}
