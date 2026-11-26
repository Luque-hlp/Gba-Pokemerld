/**
 * Compositor de línea: ventanas (WIN0, WIN1, OBJ, exterior), prioridades y efectos de color
 * (GBATEK, "LCD I/O Window Feature" y "LCD I/O Color Special Effects").
 */
import { COLOR_LUT } from './palette.js';

const BD = 5; // backdrop

function blendAlpha(a, b, eva, evb) {
  const r = Math.min(31, ((a & 31) * eva + (b & 31) * evb) >> 4);
  const g = Math.min(31, (((a >> 5) & 31) * eva + ((b >> 5) & 31) * evb) >> 4);
  const bl = Math.min(31, (((a >> 10) & 31) * eva + ((b >> 10) & 31) * evb) >> 4);
  return r | (g << 5) | (bl << 10);
}
function brighten(c, ev) {
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  return (r + (((31 - r) * ev) >> 4)) | ((g + (((31 - g) * ev) >> 4)) << 5) | ((b + (((31 - b) * ev) >> 4)) << 10);
}
function darken(c, ev) {
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  return (r - ((r * ev) >> 4)) | ((g - ((g * ev) >> 4)) << 5) | ((b - ((b * ev) >> 4)) << 10);
}

/**
 * @param {object} ppu
 * @param {number} y línea
 * @param {Int32Array[]} bgLines líneas de BG0–3 (o null si el BG no existe en el modo actual)
 * @param {object} obj { color, prio, semi, win }
 * @param {Uint32Array} fb framebuffer RGBA
 */
export function composeLine(ppu, y, bgLines, bgEnabled, obj, fb) {
  const regs = ppu.io.regs;
  const dispcnt = regs[0];
  const backdrop = ppu.bus.v16.pal[0] & 0x7fff;
  const bldcnt = regs[0x28], bldalpha = regs[0x29], bldy = regs[0x2a];
  const effect = (bldcnt >> 6) & 3, t1 = bldcnt & 0x3f, t2 = (bldcnt >> 8) & 0x3f;
  const eva = Math.min(16, bldalpha & 31), evb = Math.min(16, (bldalpha >> 8) & 31), evy = Math.min(16, bldy & 31);
  const objOn = (dispcnt & 0x1000) !== 0;
  const winAny = (dispcnt & 0xe000) !== 0;
  const winin = regs[0x24], winout = regs[0x25];
  // Ventanas: límites de la línea
  const w0 = (dispcnt & 0x2000) && inRangeV(regs[0x22], y);
  const w1 = (dispcnt & 0x4000) && inRangeV(regs[0x23], y);
  const wObj = (dispcnt & 0x8000) !== 0;
  const prioBg = [regs[4] & 3, regs[5] & 3, regs[6] & 3, regs[7] & 3];
  const base = y * 240;
  for (let x = 0; x < 240; x++) {
    let ctl = 0x3f;
    if (winAny) {
      if (w0 && inRangeH(regs[0x20], x)) ctl = winin & 0x3f;
      else if (w1 && inRangeH(regs[0x21], x)) ctl = (winin >> 8) & 0x3f;
      else if (wObj && objOn && obj.win[x]) ctl = (winout >> 8) & 0x3f;
      else ctl = winout & 0x3f;
    }
    // Capas visibles de arriba abajo: por prioridad 0..3; a igual prioridad, OBJ primero y luego BG0..3
    let top = BD, topC = backdrop, sec = BD, secC = backdrop, found = 0;
    const objVisible = objOn && (ctl & 0x10) && obj.color[x] >= 0;
    for (let p = 0; p < 4 && found < 2; p++) {
      if (objVisible && obj.prio[x] === p) {
        if (found === 0) { top = 4; topC = obj.color[x]; } else { sec = 4; secC = obj.color[x]; }
        found++;
        if (found === 2) break;
      }
      for (let b = 0; b < 4; b++) {
        if (!bgEnabled[b] || prioBg[b] !== p || !(ctl & (1 << b))) continue;
        const c = bgLines[b][x];
        if (c < 0) continue;
        if (found === 0) { top = b; topC = c; } else { sec = b; secC = c; }
        found++;
        if (found === 2) break;
      }
    }
    let out = topC;
    const semiObj = top === 4 && obj.semi[x];
    if (semiObj && (t2 & (1 << sec))) out = blendAlpha(topC, secC, eva, evb);
    else if ((ctl & 0x20) && (t1 & (1 << top)) && effect) {
      if (effect === 1) { if (t2 & (1 << sec)) out = blendAlpha(topC, secC, eva, evb); }
      else if (effect === 2) out = brighten(topC, evy);
      else out = darken(topC, evy);
    }
    fb[base + x] = COLOR_LUT[out];
  }
}

function inRangeH(reg, x) {
  const x1 = reg >> 8, x2 = reg & 0xff;
  return x1 <= x2 ? x >= x1 && x < x2 : x >= x1 || x < x2;
}
function inRangeV(reg, y) {
  const y1 = reg >> 8, y2 = reg & 0xff;
  return y1 <= y2 ? y >= y1 && y < y2 : y >= y1 || y < y2;
}
