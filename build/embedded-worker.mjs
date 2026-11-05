import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// BRAT installs main.js, manifest.json and styles.css, not arbitrary extra assets.
// Compile the worker separately, then import its complete source as a string.
// Watch every worker dependency so dev rebuilds cannot leave an outdated worker.
export function embeddedWorkerPlugin() {
  return {
    name: 'image-toolkit-embedded-worker',
    setup(builder) {
      builder.onResolve({ filter: /^image-toolkit:processing-worker$/ }, () => ({
        path: 'processing-worker',
        namespace: 'image-toolkit-worker',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'image-toolkit-worker' }, async () => {
        const result = await build({
          absWorkingDir: root,
          entryPoints: [resolve(root, 'src/processing-worker.ts')],
          bundle: true,
          platform: 'browser',
          format: 'iife',
          target: 'es2020',
          write: false,
          metafile: true,
        });
        return {
          contents: result.outputFiles[0].text,
          loader: 'text',
          watchFiles: Object.keys(result.metafile.inputs).map(input => resolve(root, input)),
        };
      });
    },
  };
}
