import { defineConfig, type Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Resolves component CSS imports (`with { type: 'css' }`) into native
 * CSSStyleSheet ESM modules so shadow roots can adopt them directly.
 */
function cssModuleScripts(): Plugin {
  return {
    name: 'css-module-scripts',
    enforce: 'pre',
    // Resolve component CSS relative paths to absolute paths with virtual .js extension to bypass CSS pipelines
    resolveId(source, importer) {
      if (source.endsWith('.css') && importer && importer.includes('scripts/components')) {
        const absolutePath = path.resolve(path.dirname(importer), source);
        return absolutePath + '.js';
      }
      return null;
    },
    // Load the CSS file and return it as a native CSSStyleSheet ESM module
    async load(id) {
      if (id.endsWith('.css.js')) {
        const cleanPath = id.slice(0, -3);
        const content = await fs.promises.readFile(cleanPath, 'utf-8');
        const escapedContent = JSON.stringify(content);
        return {
          code: `
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(${escapedContent});
            export default sheet;
          `,
          map: { mappings: '' }
        };
      }
      return null;
    }
  };
}

/**
 * After the build completes, walks dist/ and injects the full file list and a
 * content-derived build id into dist/sw.js (replacing the null placeholders).
 * This guarantees the service worker pre-caches every emitted asset —
 * including the hashed JS/CSS bundles Vite generates — so the app is truly
 * offline-capable after the first visit, and the cache name changes on every
 * deploy whose output differs.
 */
function swPrecacheManifest(): Plugin {
  return {
    name: 'sw-precache-manifest',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const swPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const files: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            const rel = path.relative(distDir, full).split(path.sep).join('/');
            if (rel !== 'sw.js' && !rel.endsWith('.map')) files.push(rel);
          }
        }
      };
      await walk(distDir);
      files.sort();

      // Build id derived from the manifest plus index.html content, so even a
      // markup-only change (same asset names) busts the previous cache.
      const hash = crypto.createHash('sha256');
      hash.update(files.join('\n'));
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        hash.update(await fs.promises.readFile(indexPath));
      }
      const buildId = hash.digest('hex').slice(0, 12);

      const manifest = ['./', ...files];
      let sw = await fs.promises.readFile(swPath, 'utf-8');
      sw = sw
        .replace('self.__PRECACHE_MANIFEST = null;', `self.__PRECACHE_MANIFEST = ${JSON.stringify(manifest)};`)
        .replace('self.__BUILD_ID = null;', `self.__BUILD_ID = ${JSON.stringify(buildId)};`);
      await fs.promises.writeFile(swPath, sw);

      this.info(`sw.js precache manifest injected: ${manifest.length} entries, build ${buildId}`);
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [cssModuleScripts(), swPrecacheManifest()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces inside the container
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true // Required for file-change detection in container volume mounts
    }
  }
});
