import { defineConfig, type Plugin } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// Mirror of the css-module-scripts plugin in vite.config.ts so component
// modules (and their `with { type: 'css' }` imports) load under Vitest.
function cssModuleScripts(): Plugin {
  return {
    name: 'css-module-scripts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.endsWith('.css') && importer && importer.includes('scripts/components')) {
        return path.resolve(path.dirname(importer), source) + '.js';
      }
      return null;
    },
    async load(id) {
      if (id.endsWith('.css.js')) {
        const content = await fs.promises.readFile(id.slice(0, -3), 'utf-8');
        return {
          code: `const sheet = new CSSStyleSheet(); sheet.replaceSync(${JSON.stringify(content)}); export default sheet;`,
          map: { mappings: '' }
        };
      }
      return null;
    }
  };
}

export default defineConfig({
  plugins: [cssModuleScripts()],
  test: {
    // Unit + DOM integration tests only — E2E specs belong to Playwright.
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
    environmentMatchGlobs: [['tests/unit/**/*.dom.spec.ts', 'happy-dom']]
  }
});
