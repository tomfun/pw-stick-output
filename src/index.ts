import parseArgs from 'minimist';
import { AssertionError } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MinimalAlphaConfigItem } from './configHelper.js';
import { configHelper } from './configHelper.js';
import start from './findModuleByName.js';

const require = createRequire(import.meta.url);

//   global in CJS  ↘︎              global in ESM
(globalThis as typeof globalThis & { configHelper: typeof configHelper }).configHelper = configHelper;

(async () => {
  let config: MinimalAlphaConfigItem[];

  try {
    const args = parseArgs<{
      c: string | undefined;
    }>(process.argv.slice(2), {
      alias: {
        c: 'config',
      },
      string: ['config'],
    });
    const { c } = args;
    if (!c) {
      throw new AssertionError({ message: 'Expected --config <file>' });
    }
    const cfgPath = resolve(c);
    switch (extname(cfgPath)) {
      case '.json': {
        // Node ≥20 can use `await import(file, { assert: { type: 'json' } })`,
        // but an old-school read + JSON.parse works everywhere:
        const json = await readFile(cfgPath, 'utf8');
        config = JSON.parse(json);
        break;
      }
      case '.cjs': // <- force real CommonJS
        config = require(cfgPath);
        break;

      default: {
        // Works for .mjs
        const url = pathToFileURL(cfgPath).href;
        const mod = await import(url);
        // ▸ If the config exports `default`, use that; otherwise use the module record itself.
        config = mod.default ?? mod;
      }
    }

    if (!config || !Array.isArray(config)) {
      throw new AssertionError({ message: 'Expected array for config' });
    }
  } catch (e) {
    if (e instanceof Error && e.message.match(/module is not defined in ES module/)) {
      console.error(`Rename file to *.cjs`);
    } else {
      console.error(e as Error);
    }
    process.exit(1);
  }
  return start(config);
})();
