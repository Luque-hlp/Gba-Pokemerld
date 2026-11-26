/**
 * Sprites (OBJ) por línea (GBATEK, "LCD OBJ - OAM Attributes").
 * Rellena: color (−1 = vacío), prioridad, semitransparencia y máscara de ventana OBJ.
 * Entre sprites, gana la menor prioridad; a igual prioridad, el de menor índice en la OAM.
 */
const SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],   // cuadrado
  [[16, 8], [32, 8], [32, 16], [64, 32]],   // horizontal
  [[8, 16], [8, 32], [16, 32], [32, 64]],   // vertical
];

export function renderSpriteLine(ppu, y, color, prio, semi, win) {
  color.fill(-1); prio.fill(4); semi.fill(0); win.fill(0);
  const regs = ppu.io.regs, oam = ppu.bus.v16.oam, vram = ppu.bus.vram, pal = ppu.bus.v16.pal;
  const dispcnt = regs[0];
  const map1d = (dispcnt & 0x40) !== 0, bitmapMode = (dispcnt & 7) >= 3;
  const mosaicH = (regs[0x26] >> 8 & 15) + 1, mosaicV = (regs[0x26] >> 12 & 15) + 1;
  for (let i = 0; i < 128; i++) {
    const a0 = oam[i * 4], a1 = oam[i * 4 + 1], a2 = oam[i * 4 + 2];
    const affine = (a0 & 0x100) !== 0;
    if (!affine && (a0 & 0x200)) continue; // deshabilitado
    const mode = (a0 >> 10) & 3;
    if (mode === 3) continue;
    const shape = a0 >> 14;
    if (shape === 3) continue;
    const [w, h] = SIZES[shape][a1 >> 14];
    const dbl = affine && (a0 & 0x200) !== 0;
    const bw = dbl ? w * 2 : w, bh = dbl ? h * 2 : h;
    let sy = a0 & 0xff;
    let ly = (y - sy) & 0xff;
    if (ly >= bh) continue;
    if (a0 & 0x1000) ly -= ly % mosaicV;
    let sx = a1 & 0x1ff; if (sx >= 240) sx -= 512;
    const tileBase = a2 & 0x3ff;
    if (bitmapMode && tileBase < 512) continue;
    const p = (a2 >> 10) & 3, bank = a2 >> 12, c256 = (a0 & 0x2000) !== 0;
    const tilesPerRow = map1d ? (w >> 3) * (c256 ? 2 : 1) : 32;
    let pa = 0x100, pb = 0, pc = 0, pd = 0x100;
    if (affine) {
      const g = ((a1 >> 9) & 31) * 16;
      pa = (oam[g + 3] << 16) >> 16; pb = (oam[g + 7] << 16) >> 16; pc = (oam[g + 11] << 16) >> 16; pd = (oam[g + 15] << 16) >> 16;
    }
    const hflip = !affine && (a1 & 0x1000) !== 0, vflip = !affine && (a1 & 0x2000) !== 0;
    for (let lx = 0; lx < bw; lx++) {
      const x = sx + lx;
      if (x < 0 || x >= 240) continue;
      let tx, ty;
      if (affine) {
        const dx = lx - (bw >> 1), dy = ly - (bh >> 1);
        tx = ((pa * dx + pb * dy) >> 8) + (w >> 1);
        ty = ((pc * dx + pd * dy) >> 8) + (h >> 1);
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      } else {
        tx = hflip ? w - 1 - lx : lx;
        ty = vflip ? h - 1 - ly : ly;
      }
      if ((a0 & 0x1000) && mosaicH > 1) tx -= tx % mosaicH;
      let idx;
      if (c256) {
        const tile = (tileBase & (map1d ? 0x3ff : 0x3fe)) + (ty >> 3) * tilesPerRow + (tx >> 3) * 2;
        idx = vram[0x10000 + (tile & 0x3ff) * 32 + (ty & 7) * 8 + (tx & 7)];
      } else {
        const tile = tileBase + (ty >> 3) * tilesPerRow + (tx >> 3);
        idx = (vram[0x10000 + (tile & 0x3ff) * 32 + (ty & 7) * 4 + ((tx & 7) >> 1)] >> ((tx & 1) * 4)) & 15;
      }
      if (!idx) continue;
      if (mode === 2) { win[x] = 1; continue; }
      if (p < prio[x]) {
        color[x] = pal[0x100 + (c256 ? idx : bank * 16 + idx)] & 0x7fff;
        prio[x] = p; semi[x] = mode === 1 ? 1 : 0;
      }
    }
  }
}
