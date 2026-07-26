// Enforces the one rule from CLAUDE.md: overlays.js, style.css and data/*
// are byte-identical between the docs/ (Pages) and public/ (Netlify) builds.
// Edit the docs/ copy, then `npm run sync`. `--check` verifies without writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = ['overlays.js', 'style.css', 'data/plaques.min.json', 'data/stations.min.json'];
const check = process.argv.includes('--check');

const sha = (b) => createHash('sha1').update(b).digest('hex').slice(0, 12);
let drifted = 0;

for (const f of SHARED) {
  const src = readFileSync(join(root, 'docs', f));
  const dstPath = join(root, 'public', f);
  const dst = readFileSync(dstPath);
  if (sha(src) === sha(dst)) {
    console.log(`  ok    ${f}`);
    continue;
  }
  drifted++;
  if (check) {
    console.log(`  DRIFT ${f}  docs=${sha(src)} public=${sha(dst)}`);
  } else {
    writeFileSync(dstPath, src);
    console.log(`  sync  ${f}  → public/`);
  }
}

// app.js and index.html are intentionally different — flag if they converge,
// which usually means someone copied the wrong build over the other.
for (const f of ['app.js', 'index.html']) {
  if (sha(readFileSync(join(root, 'docs', f))) === sha(readFileSync(join(root, 'public', f)))) {
    console.log(`  WARN  ${f} is identical across builds — it should not be`);
  }
}

if (check && drifted) {
  console.error(`\n${drifted} shared file(s) drifted. Run: npm run sync`);
  process.exit(1);
}
console.log(check ? '\nin sync' : '\ndone');
