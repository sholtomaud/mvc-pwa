import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    {
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
    }
  ],
  server: {
    host: '0.0.0.0', // Listen on all interfaces inside the container
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true // Required for file-change detection in container volume mounts
    }
  }
});
