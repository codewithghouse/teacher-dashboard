/**
 * Pure Node.js PNG icon generator for the Teacher Dashboard PWA — zero deps.
 * Uses built-in `zlib` for DEFLATE compression. Theme: #1e3272 (teacher navy).
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
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
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
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── Draw helpers ───────────────────────────────────────────────
function setPixel(buf, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}
function fillRect(buf, w, x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(buf, w, x, y, r, g, b);
}
function fillCircle(buf, w, cx, cy, rad, r, g, b) {
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++)
      if ((x-cx)**2 + (y-cy)**2 <= rad*rad) setPixel(buf, w, x, y, r, g, b);
}

// ── Draw Teacher Edullent icon — graduation cap, navy bg, gold tassel ──
function drawIcon(size) {
  const buf = new Uint8Array(size * size * 4);

  // Rounded background #1e3272 (teacher navy)
  const r = Math.round(size * 0.18);
  const [BR, BG, BB] = [0x1e, 0x32, 0x72];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inTL = x < r     && y < r     && (x-r)**2+(y-r)**2 > r*r;
      const inTR = x>=size-r && y < r     && (x-(size-r))**2+(y-r)**2 > r*r;
      const inBL = x < r     && y>=size-r && (x-r)**2+(y-(size-r))**2 > r*r;
      const inBR = x>=size-r && y>=size-r && (x-(size-r))**2+(y-(size-r))**2 > r*r;
      if (!inTL && !inTR && !inBL && !inBR) setPixel(buf, size, x, y, BR, BG, BB);
    }
  }

  const cx = Math.floor(size / 2);
  const capCY = Math.floor(size * 0.40);
  const hw = Math.floor(size * 0.30);
  const hh = Math.floor(size * 0.14);

  // Graduation cap diamond (white)
  for (let y = capCY - hh; y <= capCY + hh; y++)
    for (let x = cx - hw; x <= cx + hw; x++)
      if (Math.abs(x-cx)/hw + Math.abs(y-capCY)/hh <= 1.0)
        setPixel(buf, size, x, y, 255, 255, 255);

  // Cap body trapezoid
  const bodyTop = capCY + Math.floor(hh * 0.5);
  const bodyBot = capCY + Math.floor(size * 0.28);
  for (let y = bodyTop; y <= bodyBot; y++) {
    const t = (y - bodyTop) / (bodyBot - bodyTop);
    const halfW = Math.floor(hw * 0.58 * (1 - t * 0.25));
    fillRect(buf, size, cx - halfW, y, cx + halfW, y, 255, 255, 255);
  }

  // Tassel pole (amber #F59E0B — same as parent for brand family)
  const poleX = cx + Math.floor(size * 0.29);
  const poleW = Math.max(2, Math.floor(size * 0.022));
  fillRect(buf, size, poleX - poleW, capCY, poleX + poleW, capCY + Math.floor(size * 0.18), 245, 158, 11);

  // Tassel ball
  fillCircle(buf, size, poleX, capCY + Math.floor(size * 0.22), Math.max(3, Math.floor(size * 0.038)), 245, 158, 11);

  return buf;
}

// ── Generate all sizes ─────────────────────────────────────────
mkdirSync('./public/icons', { recursive: true });

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
for (const s of sizes) {
  const name = s === 180
    ? './public/icons/apple-touch-icon.png'
    : `./public/icons/icon-${s}x${s}.png`;
  writeFileSync(name, makePNG(s, s, drawIcon(s)));
  console.log(`OK ${s}x${s}  ->  ${name}`);
}

// Favicon 32x32
writeFileSync('./public/favicon-32x32.png', makePNG(32, 32, drawIcon(32)));
console.log('OK 32x32  ->  public/favicon-32x32.png');

// Replace favicon.ico (browsers accept PNG with .ico extension)
writeFileSync('./public/favicon.ico', makePNG(32, 32, drawIcon(32)));
console.log('OK 32x32  ->  public/favicon.ico');

console.log('\nAll teacher-dashboard icons generated!');
