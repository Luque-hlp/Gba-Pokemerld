/**
 * Fondos (GBATEK, "LCD VRAM BG Screen Data Format" y "LCD I/O BG Control").
 * Cada función rellena una línea de 240 píxeles en `out` (Int32Array): color BGR555 o −1 (transparente).
 */
const TEXT_W = [256, 512, 256, 512], TEXT_H = [256, 256, 512, 512];

/** Fondo de texto (modos 0 y 1). */
export function renderTextLine(ppu, bg, y, out) {
  const regs = ppu.io.regs, vram = ppu.bus.vram, v16 = ppu.bus.v16.vram, pal = ppu.bus.v16.pal;
  const cnt = regs[4 + bg];
  const charBase = ((cnt >> 2) & 3) * 0x4000;
  const screenBase = ((cnt >> 8) & 31) * 0x800;
  const c256 = (cnt & 0x80) !== 0, size = cnt >> 14;
  const w = TEXT_W[size], h = TEXT_H[size];
  const hofs = regs[8 + bg * 2] & 0x1ff, vofs = regs[9 + bg * 2] & 0x1ff;
  let line = y;
  const mosaic = (cnt & 0x40) !== 0;
  const mosH = mosaic ? (regs[0x26] & 15) + 1 : 1;
  if (mosaic) { const mv = ((regs[0x26] >> 4) & 15) + 1; line -= line % mv; }
  const yy = (line + vofs) & (h - 1);
  const tileY = yy >> 3, sbRow = (tileY >> 5) * (w >> 8);
  for (let x = 0; x < 240; x++) {
    const sx = mosH > 1 ? x - (x % mosH) : x;
    const xx = (sx + hofs) & (w - 1);
    const tileX = xx >> 3;
    const entry = v16[(screenBase + (sbRow + (tileX >> 5)) * 0x800 + ((tileY & 31) * 32 + (tileX & 31)) * 2) >> 1];
    const tile = entry & 0x3ff;
    const px = entry & 0x400 ? 7 - (xx & 7) : xx & 7;
    const py = entry & 0x800 ? 7 - (yy & 7) : yy & 7;
    if (c256) {
      const a = charBase + tile * 64 + py * 8 + px;
      if (a >= 0x10000) { out[x] = -1; continue; }
      const idx = vram[a];
      out[x] = idx ? pal[idx] & 0x7fff : -1;
    } else {
      const a = charBase + tile * 32 + py * 4 + (px >> 1);
      if (a >= 0x10000) { out[x] = -1; continue; }
      const idx = (vram[a] >> ((px & 1) * 4)) & 15;
      out[x] = idx ? pal[(entry >> 12) * 16 + idx] & 0x7fff : -1;
    }
  }
}

/** Fondo afín (modos 1 y 2): mapa de bytes, tiles de 8 bpp, rotación y escalado. */
export function renderAffineLine(ppu, bg, out) {
  const regs = ppu.io.regs, vram = ppu.bus.vram, pal = ppu.bus.v16.pal;
  const cnt = regs[4 + bg];
  const charBase = ((cnt >> 2) & 3) * 0x4000;
  const screenBase = ((cnt >> 8) & 31) * 0x800;
  const size = 128 << (cnt >> 14), tiles = size >> 3, wrap = (cnt & 0x2000) !== 0;
  const k = bg === 2 ? 0x10 : 0x18;
  const pa = (regs[k] << 16) >> 16, pc = (regs[k + 2] << 16) >> 16;
  let tx = ppu.refX[bg - 2], ty = ppu.refY[bg - 2];
  for (let x = 0; x < 240; x++, tx += pa, ty += pc) {
    let px = tx >> 8, py = ty >> 8;
    if (wrap) { px &= size - 1; py &= size - 1; }
    else if (px < 0 || py < 0 || px >= size || py >= size) { out[x] = -1; continue; }
    const tile = vram[screenBase + (py >> 3) * tiles + (px >> 3)];
    const idx = vram[charBase + tile * 64 + (py & 7) * 8 + (px & 7)];
    out[x] = idx ? pal[idx] & 0x7fff : -1;
  }
}

/** Modos de mapa de bits 3, 4 y 5 (BG2, con transformación afín). */
export function renderBitmapLine(ppu, mode, out) {
  const regs = ppu.io.regs, vram = ppu.bus.vram, v16 = ppu.bus.v16.vram, pal = ppu.bus.v16.pal;
  const pa = (regs[0x10] << 16) >> 16, pc = (regs[0x12] << 16) >> 16; // BG2PA (0x20) y BG2PC (0x24)
  const frame = (regs[0] & 0x10) && mode !== 3 ? 0xa000 : 0;
  const w = mode === 5 ? 160 : 240, h = mode === 5 ? 128 : 160;
  let tx = ppu.refX[0], ty = ppu.refY[0];
  for (let x = 0; x < 240; x++, tx += pa, ty += pc) {
    const px = tx >> 8, py = ty >> 8;
    if (px < 0 || py < 0 || px >= w || py >= h) { out[x] = -1; continue; }
    if (mode === 4) { const idx = vram[frame + py * 240 + px]; out[x] = idx ? pal[idx] & 0x7fff : -1; }
    else out[x] = v16[(frame + (py * w + px) * 2) >> 1] & 0x7fff;
  }
}
