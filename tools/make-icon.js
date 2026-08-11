// Tạo file .ico đa kích thước cho Windows từ icon nguồn, không cần thư viện ngoài.
// Mỗi mục trong ICO là một ảnh PNG (Windows Vista+ chấp nhận PNG nhúng trong ICO).
// Ảnh được vẽ lại ở từng kích thước bằng chính thuật toán vẽ của app (hình tròn
// xanh + người đứng) để nét ở cả 16px lẫn 256px.
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const GREEN = [16, 163, 127];

// Vẽ icon ở kích thước S, trả về mảng RGBA.
function draw(S) {
  const px = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const u = S / 256; // hệ số quy đổi từ thiết kế gốc 256px
  const cx = S / 2, cy = S / 2, rad = S / 2 - Math.max(1, 2 * u);
  // Nền tròn, khử răng cưa bằng cách lấy mẫu 3x3 mỗi điểm ảnh.
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
  // Hình người đứng màu trắng (toạ độ theo thiết kế 256px, quy đổi theo u).
  const rect = (x0, y0, w, h) => {
    for (let y = Math.round(y0 * u); y < Math.round((y0 + h) * u); y++) {
      for (let x = Math.round(x0 * u); x < Math.round((x0 + w) * u); x++) set(x, y, 255, 255, 255, 255);
    }
  };
  // Đầu (hình tròn)
  const hr = 22 * u, hx = 128 * u, hy = 64 * u;
  for (let y = Math.floor(hy - hr); y <= Math.ceil(hy + hr); y++) {
    for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) {
      if ((x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= hr * hr) set(x, y, 255, 255, 255, 255);
    }
  }
  rect(116, 94, 24, 74);  // thân
  rect(78, 100, 100, 16); // hai tay dang ngang
  rect(116, 168, 10, 50); // chân trái
  rect(130, 168, 10, 50); // chân phải
  return px;
}

// Đóng gói RGBA thành PNG (dùng zlib có sẵn của Node).
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
  header[p] = im.S >= 256 ? 0 : im.S;   // 0 nghĩa là 256
  header[p + 1] = im.S >= 256 ? 0 : im.S;
  header[p + 2] = 0;                    // số màu bảng màu
  header[p + 3] = 0;                    // dự trữ
  header.writeUInt16LE(1, p + 4);       // planes
  header.writeUInt16LE(32, p + 6);      // bit depth
  header.writeUInt32LE(im.data.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += im.data.length;
});

const out = process.argv[2];
fs.writeFileSync(out, Buffer.concat([header, ...imgs.map((i) => i.data)]));
// Xuất kèm bản PNG 256 để electron-builder dùng cho các nền tảng khác.
fs.writeFileSync(out.replace(/\.ico$/, '.png'), imgs[imgs.length - 1].data);
console.log(`Đã tạo ${out} — ${imgs.length} kích thước: ${SIZES.join(', ')}`);
