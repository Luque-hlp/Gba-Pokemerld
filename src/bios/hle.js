/**
 * BIOS de alto nivel (HLE). No contiene código de la BIOS de Nintendo.
 *
 * 1) Imagen mínima propia en 0x00000000 con el vector de IRQ (6 instrucciones escritas para este
 *    proyecto a partir del comportamiento documentado en GBATEK, "BIOS Interrupt Handling"):
 *      stmfd sp!, {r0-r3, r12, lr}   ; guardar registros volátiles
 *      mov   r0, #0x04000000
 *      add   lr, pc, #0              ; volver a la instrucción siguiente al salto
 *      ldr   pc, [r0, #-4]           ; saltar al manejador del juego (puntero en 0x03007FFC)
 *      ldmfd sp!, {r0-r3, r12, lr}
 *      subs  pc, lr, #4              ; retorno de la IRQ
 * 2) Las llamadas SWI se ejecutan en JavaScript (no se entra en modo supervisor).
 *
 * Cada función se documenta con su especificación (GBATEK, "BIOS Functions").
 */
const SIN = new Int16Array(256);
for (let i = 0; i < 256; i++) SIN[i] = Math.round(Math.sin((i * 2 * Math.PI) / 256) * 0x4000);
const sinLut = (a) => SIN[a & 0xff];
const cosLut = (a) => SIN[(a + 64) & 0xff];

export function buildBiosImage() {
  const bios = new Uint8Array(0x4000);
  const dv = new DataView(bios.buffer);
  const LOOP = 0xeafffffe; // b .
  for (let v = 0; v < 0x20; v += 4) dv.setUint32(v, LOOP, true);
  dv.setUint32(0x18, 0xea000042, true); // b 0x128 (destino = 0x18 + 8 + 0x42·4)
  const irq = [0xe92d500f, 0xe3a00301, 0xe28fe000, 0xe510f004, 0xe8bd500f, 0xe25ef004];
  irq.forEach((w, k) => dv.setUint32(0x128 + k * 4, w, true));
  return bios;
}

/** ArcTan de la BIOS: aproximación polinómica documentada. Entrada y salida en punto fijo 1.14 (±π/2 = ±0x4000). */
export function biosArcTan(i) {
  i = (i << 16) >> 16; // s16
  const a = -((i * i) >> 14);
  let b = ((0xa9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91c;
  b = ((b * a) >> 14) + 0xfb6;
  b = ((b * a) >> 14) + 0x16aa;
  b = ((b * a) >> 14) + 0x2081;
  b = ((b * a) >> 14) + 0x3651;
  b = ((b * a) >> 14) + 0xa2f9;
  return (i * b) >> 16;
}

/** ArcTan2(x, y): ángulo completo 0..0xFFFF por cuadrantes, usando biosArcTan sobre el cociente ≤ 1. */
export function biosArcTan2(x, y) {
  x = (x << 16) >> 16; y = (y << 16) >> 16;
  const at = (n, d) => biosArcTan(Math.trunc((n * 0x4000) / d));
  let r;
  if (y === 0) r = x >= 0 ? 0 : 0x8000;
  else if (x === 0) r = y >= 0 ? 0x4000 : 0xc000;
  else if (y > 0) {
    if (x > 0) r = x >= y ? at(y, x) : 0x4000 - at(x, y);
    else r = -x >= y ? at(y, x) + 0x8000 : 0x4000 - at(x, y);
  } else if (x < 0) r = -x > -y ? at(y, x) + 0x8000 : 0xc000 - at(x, y);
  else r = x >= -y ? at(y, x) + 0x10000 : 0xc000 - at(x, y);
  return r & 0xffff;
}

export class BiosHLE {
  /** @param {object} emu bus, cpu, irq, io, log, m4aTemplate */
  constructor(emu) {
    this.emu = emu;
    this.calls = new Uint32Array(256);
    this.unknown = new Map();
    this.m4aTemplate = null; // dirección de la plantilla de 36 punteros m4a en la ROM (o null)
  }

  swi(n) {
    const { cpu, bus, irq } = this.emu;
    const r = cpu.r;
    this.calls[n]++;
    switch (n) {
      case 0x00: return this.softReset();
      case 0x01: return this.registerRamReset(r[0]);
      case 0x02: irq.halted = true; return; // Halt
      case 0x03: irq.halted = true; irq.stopped = true; return; // Stop
      case 0x04: return this.intrWait(r[0] !== 0, r[1] & 0xffff);
      case 0x05: return this.intrWait(true, 1);
      case 0x06: return this.div(r[0] | 0, r[1] | 0);
      case 0x07: return this.div(r[1] | 0, r[0] | 0); // DivArm: argumentos invertidos
      case 0x08: r[0] = Math.floor(Math.sqrt(r[0] >>> 0)); cpu.cycles += 50; return;
      case 0x09: r[0] = biosArcTan(r[0]) >>> 0; cpu.cycles += 30; return;
      case 0x0a: r[0] = biosArcTan2(r[0], r[1]); cpu.cycles += 50; return;
      case 0x0b: return this.cpuSet(r[0], r[1], r[2]);
      case 0x0c: return this.cpuFastSet(r[0], r[1], r[2]);
      case 0x0d: r[0] = 0xbaae187f; return; // GetBiosChecksum: valor documentado de la BIOS de GBA
      case 0x0e: return this.bgAffineSet(r[0], r[1], r[2]);
      case 0x0f: return this.objAffineSet(r[0], r[1], r[2], r[3]);
      case 0x10: return this.bitUnPack(r[0], r[1], r[2]);
      case 0x11: return this.lz77(r[0], r[1], false);
      case 0x12: return this.lz77(r[0], r[1], true);
      case 0x13: return this.huffman(r[0], r[1]);
      case 0x14: return this.rl(r[0], r[1], false);
      case 0x15: return this.rl(r[0], r[1], true);
      case 0x16: return this.diff8(r[0], r[1], false);
      case 0x17: return this.diff8(r[0], r[1], true);
      case 0x18: return this.diff16(r[0], r[1]);
      case 0x19: { // SoundBias: sube/baja el nivel de SOUNDBIAS a 0x200 o 0
        const cur = bus.read16(0x04000088);
        bus.write16(0x04000088, (cur & 0xfc00) | (r[0] ? 0x200 : 0));
        return;
      }
      case 0x1f: { // MidiKey2Freq(wa, mk, fp) = wa->freq / 2^((180 − mk − fp/256) / 12)
        const freq = bus.read32((r[0] + 4) >>> 0);
        r[0] = (freq / Math.pow(2, (180 - (r[1] & 0xff) - (r[2] & 0xff) / 256) / 12)) >>> 0;
        return;
      }
      case 0x25: r[0] = 1; return; // MultiBoot: sin cable, siempre falla
      case 0x2a: return this.musicPlayerJumpTableCopy(r[0]);
      default:
        this.unknown.set(n, (this.unknown.get(n) || 0) + 1);
        this.emu.log?.('warn', `SWI 0x${n.toString(16)} no implementada (PC ${(cpu.next >>> 0).toString(16)})`);
    }
  }

  // ------------------------------------------------------------------ sistema
  softReset() {
    const { cpu, bus } = this.emu;
    const flag = bus.read8(0x03007ffa);
    for (let a = 0x03007e00; a < 0x03008000; a += 4) bus.write32(a, 0);
    cpu.resetToRom(flag ? 0x02000000 : 0x08000000);
  }

  registerRamReset(flags) {
    const { bus } = this.emu;
    if (flags & 1) bus.ewram.fill(0);
    if (flags & 2) bus.iwram.fill(0, 0, 0x7e00); // los últimos 0x200 bytes (pilas, vectores) se conservan
    if (flags & 4) bus.pal.fill(0);
    if (flags & 8) bus.vram.fill(0);
    if (flags & 16) bus.oam.fill(0);
    if (flags & 32) for (let a = 0x120; a < 0x160; a += 2) bus.write16(0x04000000 + a, 0);
    if (flags & 64) for (let a = 0x60; a < 0xa8; a += 2) bus.write16(0x04000000 + a, 0);
    if (flags & 128) {
      for (let a = 0x00; a < 0x60; a += 2) bus.write16(0x04000000 + a, 0);
      bus.write16(0x04000000, 0x0080); // DISPCNT: forced blank
      bus.write16(0x04000020, 0x100); bus.write16(0x04000026, 0x100); bus.write16(0x04000030, 0x100); bus.write16(0x04000036, 0x100);
    }
  }

  /**
   * IntrWait/VBlankIntrWait. La BIOS activa IME y espera a que el manejador del juego marque
   * el bit en 0x03007FF8 (BIOS_IF). Implementación: si el bit no está, se detiene la CPU (HALT)
   * y se vuelve a ejecutar la misma SWI al despertar, sin repetir el borrado inicial.
   */
  intrWait(discard, mask) {
    const { cpu, bus, irq } = this.emu;
    irq.ime = 1;
    if (!cpu.inIntrWait) {
      cpu.inIntrWait = true;
      if (discard) bus.write16(0x03007ff8, bus.read16(0x03007ff8) & ~mask);
    }
    const flags = bus.read16(0x03007ff8);
    if (flags & mask) {
      bus.write16(0x03007ff8, flags & ~mask);
      cpu.inIntrWait = false;
      return;
    }
    irq.halted = true;
    cpu.branch(cpu.next - (cpu.t ? 2 : 4)); // repetir la SWI tras la interrupción
  }

  div(num, den) {
    const { cpu } = this.emu, r = cpu.r;
    if (den === 0) { // la BIOS real entra en un bucle muy largo; se devuelve un valor definido
      this.emu.log?.('warn', `Div entre 0 (numerador ${num})`);
      r[0] = num < 0 ? -1 >>> 0 : 1; r[1] = num >>> 0; r[3] = 1; return;
    }
    const q = Math.trunc(num / den);
    r[0] = q >>> 0; r[1] = (num - q * den) >>> 0; r[3] = Math.abs(q) >>> 0;
    cpu.cycles += 40;
  }

  // ------------------------------------------------------------------ copias
  cpuSet(src, dst, ctrl) {
    const { bus, cpu } = this.emu;
    const count = ctrl & 0x1fffff, fill = (ctrl >>> 24) & 1, word = (ctrl >>> 26) & 1;
    if (word) {
      src &= ~3; dst &= ~3;
      const v = fill ? bus.read32(src) : 0;
      for (let k = 0; k < count; k++) { bus.write32(dst + k * 4, fill ? v : bus.read32(src + k * 4)); }
    } else {
      src &= ~1; dst &= ~1;
      const v = fill ? bus.read16(src) : 0;
      for (let k = 0; k < count; k++) { bus.write16(dst + k * 2, fill ? v : bus.read16(src + k * 2)); }
    }
    cpu.cycles += 10 + count * 4;
  }
  cpuFastSet(src, dst, ctrl) {
    const { bus, cpu } = this.emu;
    const count = ((ctrl & 0x1fffff) + 7) & ~7, fill = (ctrl >>> 24) & 1; // múltiplo de 8 palabras
    src &= ~3; dst &= ~3;
    const v = fill ? bus.read32(src) : 0;
    for (let k = 0; k < count; k++) bus.write32(dst + k * 4, fill ? v : bus.read32(src + k * 4));
    cpu.cycles += 10 + count * 2;
  }

  // ------------------------------------------------------------------ afines
  bgAffineSet(src, dst, count) {
    const { bus } = this.emu;
    const s16 = (a) => (bus.read16(a) << 16) >> 16, s32 = (a) => bus.read32(a) | 0;
    for (let k = 0; k < count; k++, src += 20, dst += 16) {
      const ox = s32(src), oy = s32(src + 4), dx = s16(src + 8), dy = s16(src + 10);
      const sx = s16(src + 12), sy = s16(src + 14), theta = bus.read16(src + 16) >>> 8;
      const cos = cosLut(theta), sin = sinLut(theta);
      const pa = (sx * cos) >> 14, pb = -((sx * sin) >> 14), pc = (sy * sin) >> 14, pd = (sy * cos) >> 14;
      bus.write16(dst, pa); bus.write16(dst + 2, pb); bus.write16(dst + 4, pc); bus.write16(dst + 6, pd);
      bus.write32(dst + 8, (ox - (pa * dx + pb * dy)) >>> 0);
      bus.write32(dst + 12, (oy - (pc * dx + pd * dy)) >>> 0);
    }
  }
  objAffineSet(src, dst, count, stride) {
    const { bus } = this.emu;
    const s16 = (a) => (bus.read16(a) << 16) >> 16;
    for (let k = 0; k < count; k++, src += 8, dst += stride * 4) {
      const sx = s16(src), sy = s16(src + 2), theta = bus.read16(src + 4) >>> 8;
      const cos = cosLut(theta), sin = sinLut(theta);
      bus.write16(dst, (sx * cos) >> 14);
      bus.write16(dst + stride, -((sx * sin) >> 14));
      bus.write16(dst + stride * 2, (sy * sin) >> 14);
      bus.write16(dst + stride * 3, (sy * cos) >> 14);
    }
  }

  // ------------------------------------------------------------------ descompresión
  /** Escribe bytes en el destino: a WRAM byte a byte; a VRAM en halfwords (la VRAM no acepta bytes). */
  #emit(dst, data, vram) {
    const { bus, cpu } = this.emu;
    if (vram) { for (let k = 0; k + 1 < data.length; k += 2) bus.write16(dst + k, data[k] | (data[k + 1] << 8)); if (data.length & 1) bus.write16(dst + data.length - 1, data[data.length - 1]); }
    else for (let k = 0; k < data.length; k++) bus.write8(dst + k, data[k]);
    cpu.cycles += data.length * 3;
  }

  lz77(src, dst, vram) {
    const { bus } = this.emu;
    const header = bus.read32(src);
    const size = header >>> 8;
    const out = new Uint8Array(size);
    let s = src + 4, o = 0;
    while (o < size) {
      const flags = bus.read8(s++);
      for (let bit = 7; bit >= 0 && o < size; bit--) {
        if (flags & (1 << bit)) {
          const b0 = bus.read8(s++), b1 = bus.read8(s++);
          const len = (b0 >> 4) + 3, disp = (((b0 & 15) << 8) | b1) + 1;
          for (let k = 0; k < len && o < size; k++, o++) out[o] = o - disp >= 0 ? out[o - disp] : 0;
        } else out[o++] = bus.read8(s++);
      }
    }
    this.#emit(dst, out, vram);
  }

  rl(src, dst, vram) {
    const { bus } = this.emu;
    const size = bus.read32(src) >>> 8;
    const out = new Uint8Array(size);
    let s = src + 4, o = 0;
    while (o < size) {
      const flag = bus.read8(s++);
      if (flag & 0x80) { const len = (flag & 0x7f) + 3, v = bus.read8(s++); for (let k = 0; k < len && o < size; k++) out[o++] = v; }
      else { const len = (flag & 0x7f) + 1; for (let k = 0; k < len && o < size; k++) out[o++] = bus.read8(s++); }
    }
    this.#emit(dst, out, vram);
  }

  huffman(src, dst) {
    const { bus } = this.emu;
    const header = bus.read32(src);
    const bits = header & 15, size = header >>> 8;
    const treeSize = (bus.read8(src + 4) + 1) * 2;
    const treeBase = src + 5;
    let stream = src + 4 + treeSize;
    const out = new Uint8Array(size);
    let o = 0, nodeAddr = treeBase, outBuf = 0, outBits = 0;
    let word = 0, wordBits = 0;
    let node = bus.read8(nodeAddr);
    while (o < size) {
      if (wordBits === 0) { word = bus.read32(stream); stream += 4; wordBits = 32; }
      const bit = (word >>> 31) & 1; word = (word << 1) >>> 0; wordBits--;
      const next = (nodeAddr & ~1) + (node & 0x3f) * 2 + 2 + bit;
      const isLeaf = bit ? node & 0x40 : node & 0x80;
      if (isLeaf) {
        outBuf |= bus.read8(next) << outBits; outBits += bits;
        if (outBits === 8) { out[o++] = outBuf & 0xff; outBuf = 0; outBits = 0; }
        nodeAddr = treeBase; node = bus.read8(nodeAddr);
      } else { nodeAddr = next; node = bus.read8(nodeAddr); }
    }
    this.#emit(dst, out, false);
  }

  diff8(src, dst, vram) {
    const { bus } = this.emu;
    const size = bus.read32(src) >>> 8;
    const out = new Uint8Array(size);
    let acc = 0;
    for (let k = 0; k < size; k++) { acc = (acc + bus.read8(src + 4 + k)) & 0xff; out[k] = acc; }
    this.#emit(dst, out, vram);
  }
  diff16(src, dst) {
    const { bus } = this.emu;
    const size = bus.read32(src) >>> 8;
    let acc = 0;
    for (let k = 0; k < size; k += 2) { acc = (acc + bus.read16(src + 4 + k)) & 0xffff; bus.write16(dst + k, acc); }
  }

  bitUnPack(src, dst, info) {
    const { bus } = this.emu;
    const len = bus.read16(info), srcW = bus.read8(info + 2), dstW = bus.read8(info + 3);
    const offWord = bus.read32(info + 4), offset = offWord & 0x7fffffff, zeroToo = offWord >>> 31;
    let outWord = 0, outBits = 0, d = dst;
    for (let k = 0; k < len; k++) {
      const byte = bus.read8(src + k);
      for (let b = 0; b < 8; b += srcW) {
        let v = (byte >> b) & ((1 << srcW) - 1);
        if (v || zeroToo) v += offset;
        outWord = (outWord | ((v & ((1 << dstW) - 1)) << outBits)) >>> 0;
        outBits += dstW;
        if (outBits >= 32) { bus.write32(d, outWord); d += 4; outWord = 0; outBits = 0; }
      }
    }
  }

  // ------------------------------------------------------------------ sonido
  /**
   * MusicPlayerJumpTableCopy (0x2A): la BIOS copia 36 punteros a sus rutinas del reproductor m4a.
   * Sin BIOS real, se copia la plantilla equivalente que incluye la ROM del juego (localizada por
   * forma al cargarla; ver docs/PLAN.md).
   */
  musicPlayerJumpTableCopy(dst) {
    const { bus } = this.emu;
    if (this.m4aTemplate === null) {
      this.emu.log?.('error', 'SWI 0x2A: no se encontró la plantilla m4a en la ROM; la música no funcionará');
      return;
    }
    for (let k = 0; k < 36; k++) bus.write32(dst + k * 4, bus.read32(this.m4aTemplate + k * 4));
    this.m4aTableDst = dst;
  }
}

/**
 * Busca la plantilla m4a: 36 punteros Thumb a ROM donde las entradas 0, 5, 6, 7 y 8 son la misma
 * rutina (ply_fine) y las entradas 1 a 4 son distintas. Devuelve la dirección GBA o null.
 */
export function findM4aTemplate(rom, limit = rom.length) {
  const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  for (let o = 0; o + 144 <= limit; o += 4) {
    const t0 = dv.getUint32(o, true);
    if ((t0 >>> 24) !== 8 || !(t0 & 1)) continue;
    if (dv.getUint32(o + 20, true) !== t0 || dv.getUint32(o + 24, true) !== t0 || dv.getUint32(o + 28, true) !== t0 || dv.getUint32(o + 32, true) !== t0) continue;
    let ok = true;
    for (let i = 1; i < 36 && ok; i++) { const v = dv.getUint32(o + i * 4, true); if ((v >>> 24) !== 8) ok = false; else if (i <= 4 && v === t0) ok = false; }
    if (ok) return 0x08000000 + o;
  }
  return null;
}
