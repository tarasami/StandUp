// Build a multi-size Windows .ico from the source icon, with no external library.
// Each entry inside the ICO is a PNG (Windows Vista+ accepts PNGs embedded in an ICO).
// The image is redrawn at every size by the app's own drawing routine (a green circle
// plus a standing figure) so it stays crisp at 16px and at 256px alike.
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const GREEN = [16, 163, 127];

// Draw the icon at size S, returning an RGBA buffer.
function draw(S) {
  const px = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const u = S / 256; // scale factor from the original 256px design
  const cx = S / 2, cy = S / 2, rad = S / 2 - Math.max(1, 2 * u);
  // Round background, antialiased by sampling each pixel on a 3x3 grid.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const dx = x + (sx + 0.5) / 3 - cx;
          const dy = y + (sy + 0.5) / 3 - cy;
          if (dx * dx + dy * dy <= rad * rad) hit++;
        }
      }
      if (hit) set(x, y, GREEN[0], GREEN[1], GREEN[2], Math.round((hit / 9) * 255));
    }
  }
  // The white standing figure (coordinates in the 256px design, scaled by u).
  const rect = (x0, y0, w, h) => {
    for (let y = Math.round(y0 * u); y < Math.round((y0 + h) * u); y++) {
      for (let x = Math.round(x0 * u); x < Math.round((x0 + w) * u); x++) set(x, y, 255, 255, 255, 255);
    }
  };
  // Head (a circle)
  const hr = 22 * u, hx = 128 * u, hy = 64 * u;
  for (let y = Math.floor(hy - hr); y <= Math.ceil(hy + hr); y++) {
    for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) {
      if ((x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= hr * hr) set(x, y, 255, 255, 255, 255);
    }
  }
  rect(116, 94, 24, 74);  // torso
  rect(78, 100, 100, 16); // both arms, held out sideways
  rect(116, 168, 10, 50); // left leg
  rect(130, 168, 10, 50); // right leg
  return px;
}

// Wrap the RGBA buffer into a PNG (using Node's built-in zlib).
function png(px, S) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter type 0
    px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TBL = null;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TBL[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TBL[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const imgs = SIZES.map((S) => ({ S, data: png(draw(S), S) }));
const header = Buffer.alloc(6 + 16 * imgs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);            // type 1 = icon
header.writeUInt16LE(imgs.length, 4);
let offset = header.length;
imgs.forEach((im, i) => {
  const p = 6 + i * 16;
  header[p] = im.S >= 256 ? 0 : im.S;   // 0 means 256
  header[p + 1] = im.S >= 256 ? 0 : im.S;
  header[p + 2] = 0;                    // palette colour count
  header[p + 3] = 0;                    // reserved
  header.writeUInt16LE(1, p + 4);       // planes
  header.writeUInt16LE(32, p + 6);      // bit depth
  header.writeUInt32LE(im.data.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += im.data.length;
});

const out = process.argv[2];
fs.writeFileSync(out, Buffer.concat([header, ...imgs.map((i) => i.data)]));
// Also emit the 256px PNG, which electron-builder uses for other platforms.
fs.writeFileSync(out.replace(/\.ico$/, '.png'), imgs[imgs.length - 1].data);
console.log(`Wrote ${out} — ${imgs.length} sizes: ${SIZES.join(', ')}`);
