// Generates the PWA icons into docs/icons/ (run `npm run sync` to copy across).
// Pure stdlib PNG encoder — no image dependency for four flat-colour icons.
// Motif: the radius ring from the map, centred on the search pin.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'icons');

const BG = [0x14, 0x16, 0x1c];     // #14161c — the HUD background
const RING = [0x4e, 0xa8, 0xff];   // #4ea8ff — the weather/accent blue
const PIN = [0xe8, 0xea, 0xf0];    // #e8eaf0 — HUD text
const SS = 4;                      // supersampling factor (antialiasing)

// --- PNG ---------------------------------------------------------------
const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing -----------------------------------------------------------
// Everything is in 0..1 units so the same code renders every size.
const over = (dst, rgb, a) => {
  if (a <= 0) return;
  const na = a + dst[3] * (1 - a);
  for (let i = 0; i < 3; i++) {
    dst[i] = na === 0 ? 0 : (rgb[i] * a + dst[i] * dst[3] * (1 - a)) / na;
  }
  dst[3] = na;
};

/** Rounded-square signed distance; <0 inside. r and half are 0..1 units. */
function sdRoundBox(x, y, half, r) {
  const qx = Math.abs(x) - half + r;
  const qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size, { maskable }) {
  const s = maskable ? 0.72 : 1; // maskable: keep art inside the 80% safe circle
  const n = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  const px = 1 / n; // one supersample step, for edge softening

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size - 0.5;
          const v = (y + (sy + 0.5) / SS) / size - 0.5;
          const p = [0, 0, 0, 0];

          // plate — full bleed when maskable, rounded square otherwise
          const d = maskable ? -1 : sdRoundBox(u, v, 0.5, 0.115);
          over(p, BG, Math.min(1, Math.max(0, 0.5 - d / (px * 2))));

          // three concentric range rings, fading outward
          const dist = Math.hypot(u, v);
          for (const [r, a] of [[0.15, 1], [0.27, 0.62], [0.39, 0.34]]) {
            const w = 0.021 * s;
            const e = Math.abs(dist - r * s) - w / 2;
            over(p, RING, a * Math.min(1, Math.max(0, 0.5 - e / (px * 2))));
          }

          // centre pin
          over(p, PIN, Math.min(1, Math.max(0, 0.5 - (dist - 0.052 * s) / (px * 2))));

          // a contact on the middle ring, north-east
          const ang = -Math.PI / 4;
          const cx = u - Math.cos(ang) * 0.27 * s;
          const cy = v - Math.sin(ang) * 0.27 * s;
          const cd = Math.hypot(cx, cy) - 0.038 * s;
          over(p, PIN, Math.min(1, Math.max(0, 0.5 - cd / (px * 2))));

          for (let i = 0; i < 3; i++) acc[i] += p[i] * p[3]; // premultiply
          acc[3] += p[3];
        }
      }
      const t = SS * SS;
      const a = acc[3] / t;
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i++) buf[o + i] = a === 0 ? 0 : Math.round(acc[i] / t / a);
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, buf);
}

mkdirSync(out, { recursive: true });
const ICONS = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }], // iOS applies its own mask
];
for (const [name, size, opts] of ICONS) {
  const buf = render(size, opts);
  writeFileSync(join(out, name), buf);
  console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(buf.length / 1024).toFixed(1)} kB`);
}
console.log('\nwrote docs/icons/ — run `npm run sync` to copy to public/');
