/**
 * PPU: temporización de líneas y registros de estado, y renderizado por scanline a 240×160.
 * Línea = 1232 ciclos (960 visibles + 272 de HBlank); 228 líneas (160 visibles + 68 de VBlank).
 * DISPSTAT (0x04000004): bit 0 VBlank, 1 HBlank, 2 coincidencia VCount, 3–5 IRQ de cada uno,
 * bits 8–15 línea de comparación. Las referencias afines internas (BG2X/Y, BG3X/Y) se recargan
 * al escribir los registros y al comienzo de cada fotograma, y avanzan PB/PD en cada línea.
 */
import { renderTextLine, renderAffineLine, renderBitmapLine } from './background.js';
import { renderSpriteLine } from './sprites.js';
import { composeLine } from './renderer.js';
import { COLOR_LUT } from './palette.js';

export const SCREEN_W = 240, SCREEN_H = 160;

export class PPU {
  constructor(bus, io, irq) {
    this.bus = bus; this.io = io; this.irq = irq;
    this.framebuffer = new Uint32Array(SCREEN_W * SCREEN_H);
    this.dispstat = 0; this.vcount = 0;
    this.refX = new Int32Array(2); this.refY = new Int32Array(2);
    this.bgLines = [0, 1, 2, 3].map(() => new Int32Array(240));
    this.obj = { color: new Int32Array(240), prio: new Uint8Array(240), semi: new Uint8Array(240), win: new Uint8Array(240) };
    this.frame = 0;
    this.layerMask = 0x1f; // depuración: permite ocultar capas (bits BG0–3, OBJ)
  }

  writeDispstat(v) { this.dispstat = (this.dispstat & 0x7) | (v & 0xff38); }

  /** Escritura en BG2X/Y o BG3X/Y: recarga la referencia interna (28 bits con signo). */
  affineWrite(off) {
    const r = this.io.regs;
    const read28 = (o) => (((r[o >> 1] | (r[(o >> 1) + 1] << 16)) << 4) >> 4);
    if (off >= 0x28 && off < 0x2c) this.refX[0] = read28(0x28);
    else if (off >= 0x2c && off < 0x30) this.refY[0] = read28(0x2c);
    else if (off >= 0x38 && off < 0x3c) this.refX[1] = read28(0x38);
    else if (off >= 0x3c && off < 0x40) this.refY[1] = read28(0x3c);
  }
  #reloadAffine() { for (const o of [0x28, 0x2c, 0x38, 0x3c]) this.affineWrite(o); }

  /** Inicio de la línea `y`: VCOUNT, coincidencia, entrada/salida de VBlank. Devuelve true al entrar en VBlank. */
  startLine(y) {
    this.vcount = y;
    const match = ((this.dispstat >> 8) & 0xff) === y;
    if (match) { this.dispstat |= 4; if (this.dispstat & 0x20) this.irq.request(4); } else this.dispstat &= ~4;
    if (y === 160) {
      this.dispstat |= 1;
      if (this.dispstat & 0x08) this.irq.request(1);
      this.frame++;
      return true;
    }
    if (y === 227) this.dispstat &= ~1;
    if (y === 0) this.#reloadAffine();
    return false;
  }
  startHblank() { this.dispstat |= 2; if (this.dispstat & 0x10) this.irq.request(2); }
  endHblank() { this.dispstat &= ~2; }

  renderLine(y) {
    const regs = this.io.regs, dispcnt = regs[0];
    const fb = this.framebuffer;
    if (dispcnt & 0x80) { fb.fill(0xffffffff, y * 240, y * 240 + 240); this.#advanceAffine(); return; } // forced blank: blanco
    const mode = dispcnt & 7;
    const en = [false, false, false, false];
    const mask = this.layerMask;
    const on = (b) => (dispcnt & (0x100 << b)) !== 0 && (mask & (1 << b)) !== 0;
    switch (mode) {
      case 0: for (let b = 0; b < 4; b++) if (on(b)) { renderTextLine(this, b, y, this.bgLines[b]); en[b] = true; } break;
      case 1:
        for (let b = 0; b < 2; b++) if (on(b)) { renderTextLine(this, b, y, this.bgLines[b]); en[b] = true; }
        if (on(2)) { renderAffineLine(this, 2, this.bgLines[2]); en[2] = true; }
        break;
      case 2: for (let b = 2; b < 4; b++) if (on(b)) { renderAffineLine(this, b, this.bgLines[b]); en[b] = true; } break;
      case 3: case 4: case 5: if (on(2)) { renderBitmapLine(this, mode, this.bgLines[2]); en[2] = true; } break;
      default: break; // modos 6 y 7 no existen: solo backdrop
    }
    if ((dispcnt & 0x1000) || (dispcnt & 0x8000)) {
      renderSpriteLine(this, y, this.obj.color, this.obj.prio, this.obj.semi, this.obj.win);
      if (!(mask & 0x10)) this.obj.color.fill(-1);
    } else this.obj.color.fill(-1);
    composeLine(this, y, this.bgLines, en, this.obj, fb);
    this.#advanceAffine();
  }

  #advanceAffine() {
    const r = this.io.regs;
    this.refX[0] += (r[0x11] << 16) >> 16; this.refY[0] += (r[0x13] << 16) >> 16; // BG2PB, BG2PD
    this.refX[1] += (r[0x19] << 16) >> 16; this.refY[1] += (r[0x1b] << 16) >> 16; // BG3PB, BG3PD
  }

  /** Color de fondo (para depuración). */
  backdropRGBA() { return COLOR_LUT[this.bus.v16.pal[0] & 0x7fff]; }
}
