// npm run new:fn <name>  →  netlify/functions/<name>.js, served at /api/<name>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: npm run new:fn <name>   (lowercase, digits, dashes)');
  console.error('note: names starting with _ are helpers, not endpoints');
  process.exit(1);
}

const dest = join(root, 'netlify', 'functions', `${name}.js`);
if (existsSync(dest)) {
  console.error(`refusing to overwrite netlify/functions/${name}.js`);
  process.exit(1);
}

const tpl = readFileSync(join(root, 'scripts', 'templates', 'function.js'), 'utf8');
writeFileSync(dest, tpl.replaceAll('__NAME__', name));

console.log(`created netlify/functions/${name}.js`);
console.log(`  local:  http://localhost:8888/api/${name}?lat=51.342&lon=1.346`);
console.log('  then:   wire it into public/app.js or public/overlays.js');
