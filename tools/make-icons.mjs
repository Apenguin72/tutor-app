// 產生 app 圖示（不需要任何套件）：node tools/make-icons.mjs
// 藍色底＋白色月曆圖案。
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 圓角矩形的內外判斷（以 0..1 的座標）
function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

const BLUE = [37, 99, 235, 255];
const DARK = [29, 78, 216, 255];
const WHITE = [255, 255, 255, 255];
const LIGHT = [219, 231, 255, 255];
const ORANGE = [249, 146, 52, 255];

function pixelAt(px, py, size) {
  // 2×2 超取樣做簡單反鋸齒
  const acc = [0, 0, 0];
  const offs = [0.25, 0.75];
  for (const ox of offs) for (const oy of offs) {
    const c = sample((Math.floor(px) + ox) / size, (Math.floor(py) + oy) / size);
    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
  }
  return [acc[0] / 4, acc[1] / 4, acc[2] / 4, 255].map(Math.round);
}

function sample(u, v) {
  // 背景：整片藍（iOS 會自己裁圓角）
  let c = BLUE;
  // 月曆本體
  const x0 = 0.2, x1 = 0.8, y0 = 0.25, y1 = 0.8;
  if (inRoundRect(u, v, x0, y0, x1, y1, 0.07)) {
    c = WHITE;
    if (v < 0.38) c = LIGHT; // 月曆頂部
    // 格子：3 欄 × 3 列
    const cell = 0.15, rowH = 0.09, gap = 0.03;
    const gx0 = 0.5 - (3 * cell + 2 * gap) / 2, gy0 = 0.43;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
      const cx = gx0 + k * (cell + gap);
      const cy = gy0 + r * (rowH + 0.025);
      if (inRoundRect(u, v, cx, cy, cx + cell, cy + rowH, 0.02)) {
        c = r === 1 && k === 1 ? ORANGE : [205, 218, 245, 255];
      }
    }
  }
  // 掛環
  for (const rx of [0.36, 0.64]) {
    if (inRoundRect(u, v, rx - 0.025, 0.18, rx + 0.025, 0.31, 0.025)) c = DARK;
  }
  return c;
}

for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png(size, pixelAt));
  console.log('wrote', file);
}
