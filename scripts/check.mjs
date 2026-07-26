// node --check every JS file in the repo (CLAUDE.md: do this before committing).
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.netlify', 'data']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js') || e.endsWith('.mjs')) out.push(p);
  }
  return out;
}

let bad = 0;
for (const f of walk(root)) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.error(`FAIL ${relative(root, f)}`);
    console.error(String(e.stderr || e).trim().split('\n').slice(0, 5).join('\n'));
  }
}

console.log(bad ? `\n${bad} file(s) failed` : 'syntax ok');
process.exit(bad ? 1 : 0);
