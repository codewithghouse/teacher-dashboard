/**
 * iOS PWA splash screen generator for Teacher Dashboard — pure Node.js, zero deps.
 * Theme: #1e3272 (matches manifest theme_color so iOS PWA cold-start has no flash).
 */
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

// ── CRC32 ──────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG writer ─────────────────────────────────────────────────
function makePNG(w, h, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (w * 4 + 1) + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function setPixel(buf, w, h, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function fillRect(buf, w, h, x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(buf, w, h, x, y, r, g, b);
}
function fillCircle(buf, w, h, cx, cy, rad, r, g, b) {
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) setPixel(buf, w, h, x, y, r, g, b);
}

// ── Draw splash — solid bg + centered rounded white card with cap glyph ──
function drawSplash(W, H) {
  const buf = new Uint8Array(W * H * 4);
  const [BR, BG, BB] = [0x1e, 0x32, 0x72]; // theme #1e3272

  // Solid background
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = BR; buf[i * 4 + 1] = BG; buf[i * 4 + 2] = BB; buf[i * 4 + 3] = 255;
  }

  // Centered logo card — ~22% of shorter side
  const side = Math.min(W, H);
  const cardSize = Math.floor(side * 0.22);
  const cardX = Math.floor((W - cardSize) / 2);
  const cardY = Math.floor((H - cardSize) / 2);
  const radius = Math.round(cardSize * 0.22);

  // Rounded white card
  for (let y = 0; y < cardSize; y++) {
    for (let x = 0; x < cardSize; x++) {
      const inTL = x < radius           && y < radius            && (x - radius) ** 2 + (y - radius) ** 2 > radius ** 2;
      const inTR = x >= cardSize-radius && y < radius            && (x - (cardSize-radius)) ** 2 + (y - radius) ** 2 > radius ** 2;
      const inBL = x < radius           && y >= cardSize-radius  && (x - radius) ** 2 + (y - (cardSize-radius)) ** 2 > radius ** 2;
      const inBR = x >= cardSize-radius && y >= cardSize-radius  && (x - (cardSize-radius)) ** 2 + (y - (cardSize-radius)) ** 2 > radius ** 2;
      if (!inTL && !inTR && !inBL && !inBR) {
        const px = cardX + x, py = cardY + y;
        setPixel(buf, W, H, px, py, 255, 255, 255, 255);
      }
    }
  }

  // Graduation cap on card
  const cx = cardX + Math.floor(cardSize / 2);
  const cy = cardY + Math.floor(cardSize * 0.42);
  const hw = Math.floor(cardSize * 0.30);
  const hh = Math.floor(cardSize * 0.14);

  for (let y = cy - hh; y <= cy + hh; y++)
    for (let x = cx - hw; x <= cx + hw; x++)
      if (Math.abs(x - cx) / hw + Math.abs(y - cy) / hh <= 1.0)
        setPixel(buf, W, H, x, y, BR, BG, BB);

  const bodyTop = cy + Math.floor(hh * 0.5);
  const bodyBot = cy + Math.floor(cardSize * 0.26);
  for (let y = bodyTop; y <= bodyBot; y++) {
    const t = (y - bodyTop) / Math.max(1, bodyBot - bodyTop);
    const halfW = Math.floor(hw * 0.58 * (1 - t * 0.25));
    fillRect(buf, W, H, cx - halfW, y, cx + halfW, y, BR, BG, BB);
  }

  // Tassel — amber
  const poleX = cx + Math.floor(cardSize * 0.28);
  const poleW = Math.max(2, Math.floor(cardSize * 0.022));
  fillRect(buf, W, H, poleX - poleW, cy, poleX + poleW, cy + Math.floor(cardSize * 0.18), 245, 158, 11);
  fillCircle(buf, W, H, poleX, cy + Math.floor(cardSize * 0.22), Math.max(3, Math.floor(cardSize * 0.04)), 245, 158, 11);

  return buf;
}

// ── Generate ───────────────────────────────────────────────────
const sizes = [
  [640, 1136], [750, 1334], [828, 1792], [1125, 2436], [1170, 2532],
  [1179, 2556], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796],
  [1536, 2048], [1620, 2160], [1668, 2224], [1668, 2388], [2048, 2732],
];

mkdirSync('./public/splash', { recursive: true });
for (const [w, h] of sizes) {
  const name = `./public/splash/apple-splash-${w}x${h}.png`;
  writeFileSync(name, makePNG(w, h, drawSplash(w, h)));
  console.log(`OK ${w}x${h}  ->  ${name}`);
}
console.log('\nAll teacher-dashboard splash screens generated!');
