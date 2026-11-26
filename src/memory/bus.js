/**
 * Bus de memoria del GBA (GBATEK, "GBA Memory Map").
 *
 *   0x00000000 BIOS        16 KiB   (imagen propia HLE; protegida en lectura fuera de la BIOS)
 *   0x02000000 EWRAM      256 KiB   espejo cada 0x40000
 *   0x03000000 IWRAM       32 KiB   espejo cada 0x8000
 *   0x04000000 E/S          1 KiB   → io.js
 *   0x05000000 Paletas      1 KiB   espejo cada 0x400
 *   0x06000000 VRAM        96 KiB   ventana de 128 KiB: 0x18000–0x1FFFF reflejan 0x10000–0x17FFF
 *   0x07000000 OAM          1 KiB   espejo cada 0x400
 *   0x08000000 ROM (WS0), 0x0A (WS1), 0x0C (WS2)  hasta 32 MiB cada una
 *   0x0E000000 SRAM/Flash  bus de 8 bits
 *
 * Reglas de escritura de 8 bits (GBATEK): en paletas y en la zona BG de la VRAM el byte se duplica
 * en el halfword; en la zona OBJ de la VRAM y en la OAM se ignora.
 * Las lecturas sin dispositivo devuelven el "open bus": el último opcode leído por la CPU.
 *
 * Se asume una plataforma little-endian (todos los navegadores actuales) para usar vistas
 * Uint16Array/Uint32Array sobre los mismos buffers.
 */
export class Bus {
  constructor() {
    this.bios = new Uint8Array(0x4000);
    this.ewram = new Uint8Array(0x40000);
    this.iwram = new Uint8Array(0x8000);
    this.pal = new Uint8Array(0x400);
    this.vram = new Uint8Array(0x18000);
    this.oam = new Uint8Array(0x400);
    this.v16 = {}; this.v32 = {};
    for (const k of ['bios', 'ewram', 'iwram', 'pal', 'vram', 'oam']) {
      this.v16[k] = new Uint16Array(this[k].buffer); this.v32[k] = new Uint32Array(this[k].buffer);
    }
    this.rom = new Uint8Array(0); this.rom16 = new Uint16Array(0); this.rom32 = new Uint32Array(0); this.romMask = 0;
    this.io = null;        // IO (io.js)
    this.save = null;      // memoria de guardado (Flash/SRAM) o null
    this.gpio = null;      // GPIO del cartucho (RTC) o null
    this.cpu = null;
    this.openBus = 0;      // último opcode leído (lo actualiza la CPU)
    this.biosLatch = 0xe129f000; // valor devuelto al leer la BIOS desde fuera (GBATEK: tras el arranque)
    // Ciclos de espera aproximados por región (acceso no secuencial de 16 bits) para el contador de ciclos
    this.wait16 = new Uint8Array(16).fill(1);
    this.wait32 = new Uint8Array(16).fill(1);
    this.setWaitcnt(0);
  }

  loadRom(bytes) {
    // Se rellena a una potencia de 2 alineada a 4 para poder usar vistas de 16/32 bits
    let size = 1; while (size < bytes.length) size <<= 1;
    const buf = new Uint8Array(Math.max(size, 4));
    buf.set(bytes);
    this.rom = buf; this.rom16 = new Uint16Array(buf.buffer); this.rom32 = new Uint32Array(buf.buffer);
    this.romSize = bytes.length; this.romMask = buf.length - 1;
  }

  /** WAITCNT (0x04000204): ciclos de espera de la ROM y SRAM. Solo se usan para la contabilidad de ciclos. */
  setWaitcnt(v) {
    const nTab = [4, 3, 2, 8];
    const sram = nTab[v & 3];
    const ws0n = nTab[(v >> 2) & 3], ws0s = (v & 0x10) ? 1 : 2;
    const ws1n = nTab[(v >> 5) & 3], ws1s = (v & 0x80) ? 1 : 4;
    const ws2n = nTab[(v >> 8) & 3], ws2s = (v & 0x400) ? 1 : 8;
    const prefetch = !!(v & 0x4000);
    const w16 = this.wait16, w32 = this.wait32;
    w16[0] = 1; w16[2] = 3; w16[3] = 1; w16[4] = 1; w16[5] = 1; w16[6] = 1; w16[7] = 1;
    w32[0] = 1; w32[2] = 6; w32[3] = 1; w32[4] = 1; w32[5] = 2; w32[6] = 2; w32[7] = 1;
    // Con prefetch activo, las lecturas secuenciales de código cuestan ~1 ciclo; se usa una media.
    const rom = (n, s) => (prefetch ? Math.max(1, (s + 1)) : n + 1);
    w16[8] = w16[9] = rom(ws0n, ws0s); w16[10] = w16[11] = rom(ws1n, ws1s); w16[12] = w16[13] = rom(ws2n, ws2s);
    for (const r of [8, 9, 10, 11, 12, 13]) w32[r] = w16[r] + (prefetch ? 1 : 2);
    w16[14] = w16[15] = w32[14] = w32[15] = sram + 1;
    this.waitcnt = v;
  }

  // ---------------------------------------------------------------- lecturas
  read8(addr) {
    addr >>>= 0;
    switch (addr >>> 24) {
      case 0x0: return addr < 0x4000 ? this.#biosRead(addr, 1) : this.#open8(addr);
      case 0x2: return this.ewram[addr & 0x3ffff];
      case 0x3: return this.iwram[addr & 0x7fff];
      case 0x4: return this.io.read8(addr);
      case 0x5: return this.pal[addr & 0x3ff];
      case 0x6: return this.vram[vramIndex(addr)];
      case 0x7: return this.oam[addr & 0x3ff];
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd: {
        const a = addr & 0x1ffffff;
        if (this.gpio && a >= 0xc4 && a < 0xca && this.gpio.readable) return (this.gpio.read(a & ~1) >> ((a & 1) * 8)) & 0xff;
        return a < this.romSize ? this.rom[a] : ((a >> 1) >> ((a & 1) * 8)) & 0xff;
      }
      case 0xe: case 0xf: return this.save ? this.save.read8(addr & 0xffff) : 0xff;
      default: return this.#open8(addr);
    }
  }

  read16(addr) {
    addr = (addr & ~1) >>> 0;
    switch (addr >>> 24) {
      case 0x0: return addr < 0x4000 ? this.#biosRead(addr, 2) : this.openBus & 0xffff;
      case 0x2: return this.v16.ewram[(addr & 0x3ffff) >> 1];
      case 0x3: return this.v16.iwram[(addr & 0x7fff) >> 1];
      case 0x4: return this.io.read16(addr);
      case 0x5: return this.v16.pal[(addr & 0x3ff) >> 1];
      case 0x6: return this.v16.vram[vramIndex(addr) >> 1];
      case 0x7: return this.v16.oam[(addr & 0x3ff) >> 1];
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd: {
        const a = addr & 0x1ffffff;
        if (this.gpio && a >= 0xc4 && a < 0xca && this.gpio.readable) return this.gpio.read(a);
        return a < this.romSize ? this.rom16[a >> 1] : (a >> 1) & 0xffff;
      }
      case 0xe: case 0xf: { const v = this.save ? this.save.read8(addr & 0xffff) : 0xff; return v * 0x101; }
      default: return this.openBus & 0xffff;
    }
  }

  read32(addr) {
    addr = (addr & ~3) >>> 0;
    switch (addr >>> 24) {
      case 0x0: return addr < 0x4000 ? this.#biosRead(addr, 4) : this.openBus >>> 0;
      case 0x2: return this.v32.ewram[(addr & 0x3ffff) >> 2];
      case 0x3: return this.v32.iwram[(addr & 0x7fff) >> 2];
      case 0x4: return (this.io.read16(addr) | (this.io.read16(addr + 2) << 16)) >>> 0;
      case 0x5: return this.v32.pal[(addr & 0x3ff) >> 2];
      case 0x6: return this.v32.vram[vramIndex(addr) >> 2];
      case 0x7: return this.v32.oam[(addr & 0x3ff) >> 2];
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd: {
        const a = addr & 0x1ffffff;
        if (this.gpio && a >= 0xc4 && a < 0xca && this.gpio.readable) return (this.read16(addr) | (this.read16(addr + 2) << 16)) >>> 0;
        if (a < this.romSize) return this.rom32[a >> 2];
        return (((a >> 1) & 0xffff) | ((((a + 2) >> 1) & 0xffff) << 16)) >>> 0;
      }
      case 0xe: case 0xf: { const v = this.save ? this.save.read8(addr & 0xffff) : 0xff; return (v * 0x01010101) >>> 0; }
      default: return this.openBus >>> 0;
    }
  }

  /** La BIOS solo se puede leer mientras se ejecuta código de la BIOS (protección). */
  #biosRead(addr, size) {
    if (this.cpu && this.cpu.pcInBios()) {
      if (size === 1) return this.bios[addr];
      if (size === 2) return this.v16.bios[addr >> 1];
      return this.v32.bios[addr >> 2];
    }
    const v = this.biosLatch;
    if (size === 1) return (v >>> ((addr & 3) * 8)) & 0xff;
    if (size === 2) return (v >>> ((addr & 2) * 8)) & 0xffff;
    return v >>> 0;
  }
  #open8(addr) { return (this.openBus >>> ((addr & 3) * 8)) & 0xff; }

  // ---------------------------------------------------------------- escrituras
  write8(addr, v) {
    addr >>>= 0; v &= 0xff;
    switch (addr >>> 24) {
      case 0x2: this.ewram[addr & 0x3ffff] = v; return;
      case 0x3: this.iwram[addr & 0x7fff] = v; return;
      case 0x4: this.io.write8(addr, v); return;
      case 0x5: this.v16.pal[(addr & 0x3fe) >> 1] = v * 0x101; return;
      case 0x6: {
        const i = vramIndex(addr);
        // Zona BG: 0x00000–0x0FFFF en modos de tiles (0x13FFF en modos bitmap); el resto (OBJ) ignora bytes
        const bgLimit = this.io && (this.io.dispcnt & 7) >= 3 ? 0x14000 : 0x10000;
        if (i < bgLimit) this.v16.vram[i >> 1] = v * 0x101;
        return;
      }
      case 0x7: return; // OAM ignora escrituras de 8 bits
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd:
        this.#romWrite(addr, v, 1); return;
      case 0xe: case 0xf: if (this.save) this.save.write8(addr & 0xffff, v); return;
      default: return;
    }
  }

  write16(addr, v) {
    addr = (addr & ~1) >>> 0; v &= 0xffff;
    switch (addr >>> 24) {
      case 0x2: this.v16.ewram[(addr & 0x3ffff) >> 1] = v; return;
      case 0x3: this.v16.iwram[(addr & 0x7fff) >> 1] = v; return;
      case 0x4: this.io.write16(addr, v); return;
      case 0x5: this.v16.pal[(addr & 0x3ff) >> 1] = v; return;
      case 0x6: this.v16.vram[vramIndex(addr) >> 1] = v; return;
      case 0x7: this.v16.oam[(addr & 0x3ff) >> 1] = v; return;
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd:
        this.#romWrite(addr, v, 2); return;
      case 0xe: case 0xf: if (this.save) this.save.write8(addr & 0xffff, (v >>> ((addr & 1) * 8)) & 0xff); return;
      default: return;
    }
  }

  write32(addr, v) {
    addr = (addr & ~3) >>> 0; v >>>= 0;
    switch (addr >>> 24) {
      case 0x2: this.v32.ewram[(addr & 0x3ffff) >> 2] = v; return;
      case 0x3: this.v32.iwram[(addr & 0x7fff) >> 2] = v; return;
      case 0x4: this.io.write32(addr, v); return;
      case 0x5: this.v32.pal[(addr & 0x3ff) >> 2] = v; return;
      case 0x6: this.v32.vram[vramIndex(addr) >> 2] = v; return;
      case 0x7: this.v32.oam[(addr & 0x3ff) >> 2] = v; return;
      case 0x8: case 0x9: case 0xa: case 0xb: case 0xc: case 0xd:
        this.#romWrite(addr, v & 0xffff, 2); this.#romWrite(addr + 2, v >>> 16, 2); return;
      case 0xe: case 0xf: if (this.save) this.save.write8(addr & 0xffff, (v >>> ((addr & 3) * 8)) & 0xff); return;
      default: return;
    }
  }

  /** La ROM no se puede escribir; solo el puerto GPIO (RTC) en 0x080000C4–C9. */
  #romWrite(addr, v, size) {
    const a = addr & 0x1ffffff;
    if (this.gpio && a >= 0xc4 && a < 0xca) {
      if (size === 2) this.gpio.write(a & ~1, v);
      else this.gpio.write(a & ~1, (a & 1) ? (v << 8) : v);
    }
  }
}

/** Índice en la VRAM de 96 KiB para una dirección del bloque 0x06xxxxxx. */
export function vramIndex(addr) {
  let a = addr & 0x1ffff;
  if (a >= 0x18000) a -= 0x8000;
  return a;
}
