/**
 * Registros de E/S 0x04000000–0x040003FF (GBATEK, "GBA I/O Map").
 * Se guarda una copia de 16 bits de cada registro en `regs` (la usan la PPU y la APU para leer
 * su configuración) y se despachan los efectos laterales a cada módulo.
 */
export const REG = Object.freeze({
  DISPCNT: 0x000, GREENSWAP: 0x002, DISPSTAT: 0x004, VCOUNT: 0x006,
  BG0CNT: 0x008, BG1CNT: 0x00a, BG2CNT: 0x00c, BG3CNT: 0x00e,
  BG0HOFS: 0x010, BG2PA: 0x020, BG2X: 0x028, BG2Y: 0x02c, BG3PA: 0x030, BG3X: 0x038, BG3Y: 0x03c,
  WIN0H: 0x040, WIN1H: 0x042, WIN0V: 0x044, WIN1V: 0x046, WININ: 0x048, WINOUT: 0x04a,
  MOSAIC: 0x04c, BLDCNT: 0x050, BLDALPHA: 0x052, BLDY: 0x054,
  SOUND_START: 0x060, SOUND_END: 0x0a8, FIFO_A: 0x0a0, FIFO_B: 0x0a4,
  DMA_START: 0x0b0, DMA_END: 0x0e0, TIMER_START: 0x100, TIMER_END: 0x110,
  KEYINPUT: 0x130, KEYCNT: 0x132, RCNT: 0x134,
  IE: 0x200, IF: 0x202, WAITCNT: 0x204, IME: 0x208, POSTFLG: 0x300, HALTCNT: 0x301,
});

export class IO {
  /** @param {object} emu referencias: bus, cpu, ppu, apu, timers, dma, irq, keypad, now() */
  constructor(emu) {
    this.emu = emu;
    this.regs = new Uint16Array(0x200);
    this.postflg = 0;
    this.unknownWrites = new Map(); // registro de escrituras a registros no implementados (depuración)
  }
  get dispcnt() { return this.regs[0]; }

  read8(addr) { const v = this.read16(addr & ~1); return (addr & 1) ? v >> 8 : v & 0xff; }

  read16(addr) {
    const off = addr & 0xffffff;
    if (off >= 0x400) return 0;
    const e = this.emu, r = this.regs;
    switch (off & 0x3fe) {
      case REG.DISPCNT: case REG.GREENSWAP: case REG.BG0CNT: case REG.BG1CNT: case REG.BG2CNT: case REG.BG3CNT:
      case REG.WININ: case REG.WINOUT: case REG.BLDCNT: case REG.BLDALPHA:
        return r[(off & 0x3fe) >> 1];
      case REG.DISPSTAT: return e.ppu.dispstat;
      case REG.VCOUNT: return e.ppu.vcount;
      case REG.KEYINPUT: return e.keypad.keyinput;
      case REG.KEYCNT: return e.keypad.keycnt;
      case REG.IE: return e.irq.ie;
      case REG.IF: return e.irq.if;
      case REG.IME: return e.irq.ime;
      case REG.WAITCNT: return e.bus.waitcnt;
      case REG.POSTFLG: return this.postflg;
      case REG.RCNT: return e.serial.readRcnt();
      case 0x128: return e.serial.readSiocnt();
      default: break;
    }
    if (off >= REG.TIMER_START && off < REG.TIMER_END) return e.timers.read((off - 0x100) >> 2, (off & 2) !== 0, e.now());
    if (off >= REG.DMA_START && off < REG.DMA_END) {
      const i = ((off - 0xb0) / 12) | 0, k = (off - 0xb0) % 12;
      if (k === 10) return e.dma.ch[i].control; // solo el control es legible
      return 0;
    }
    if (off >= REG.SOUND_START && off < REG.SOUND_END) return e.apu ? e.apu.read16(off) : r[off >> 1];
    if (off === 0x128 || off === 0x120 || off === 0x12a || off === 0x150 || off === 0x154 || off === 0x158) return r[off >> 1]; // serie: sin cable
    return 0;
  }

  write8(addr, v) {
    const off = addr & 0xffffff;
    if (off >= 0x400) return;
    if (off === REG.HALTCNT) { this.#halt(v); return; }
    if (off === REG.POSTFLG) { this.postflg = v & 1; return; }
    if (off === REG.IF || off === REG.IF + 1) { this.emu.irq.acknowledge(v << ((off & 1) * 8)); return; }
    if (off >= REG.FIFO_A && off < REG.FIFO_B + 4) { this.emu.apu?.fifoWrite8(off < REG.FIFO_B ? 0 : 1, v); return; }
    // Resto: lectura-modificación-escritura del halfword (los registros de solo escritura usan la copia)
    const base = off & 0x3fe;
    const cur = this.regs[base >> 1];
    const nv = (off & 1) ? (cur & 0x00ff) | (v << 8) : (cur & 0xff00) | v;
    this.write16(addr & ~1, nv, off & 1 ? 0xff00 : 0x00ff);
  }

  write32(addr, v) {
    const off = addr & 0xffffff;
    if (off === REG.FIFO_A || off === REG.FIFO_B) { this.emu.apu?.fifoWrite32(off === REG.FIFO_A ? 0 : 1, v); return; }
    this.write16(addr, v & 0xffff);
    this.write16(addr + 2, v >>> 16);
  }

  /** @param {number} [byteMask] bytes realmente escritos (0xFFFF = halfword completo) */
  write16(addr, v, byteMask = 0xffff) {
    const off = addr & 0xfffffe;
    if (off >= 0x400) return;
    const e = this.emu, idx = off >> 1;
    switch (off) {
      case REG.DISPCNT: this.regs[idx] = v; return;
      case REG.DISPSTAT: e.ppu.writeDispstat(v); return;
      case REG.VCOUNT: return;
      case REG.KEYINPUT: return;
      case REG.KEYCNT: e.keypad.keycnt = v; e.keypad.check(); return;
      case REG.IE: e.irq.ie = v & 0x3fff; return;
      case REG.IF: e.irq.acknowledge(v & byteMask); return;
      case REG.IME: e.irq.ime = v & 1; return;
      case REG.WAITCNT: e.bus.setWaitcnt(v); return;
      case REG.POSTFLG:
        if (byteMask & 0x00ff) this.postflg = v & 1;
        if (byteMask & 0xff00) this.#halt(v >> 8);
        return;
      default: break;
    }
    this.regs[idx] = v;
    if (off >= 0x020 && off < 0x040) { e.ppu.affineWrite(off); return; }
    if (off >= REG.SOUND_START && off < REG.SOUND_END) {
      if (off >= REG.FIFO_A) { e.apu?.fifoWrite16(off < REG.FIFO_B ? 0 : 1, v); return; }
      e.apu?.write16(off, v); return;
    }
    if (off >= REG.DMA_START && off < REG.DMA_END) {
      const i = ((off - 0xb0) / 12) | 0, k = (off - 0xb0) % 12, c = e.dma.ch[i];
      if (k === 0) c.sad = (c.sad & 0xffff0000) | v; else if (k === 2) c.sad = ((c.sad & 0xffff) | (v << 16)) >>> 0;
      else if (k === 4) c.dad = (c.dad & 0xffff0000) | v; else if (k === 6) c.dad = ((c.dad & 0xffff) | (v << 16)) >>> 0;
      else if (k === 8) c.cnt = v;
      else if (k === 10) e.dma.writeControl(i, v);
      return;
    }
    if (off >= REG.TIMER_START && off < REG.TIMER_END) { e.timers.write((off - 0x100) >> 2, (off & 2) !== 0, v, e.now()); return; }
    if ((off >= 0x008 && off < 0x020) || (off >= 0x040 && off < 0x056)) return; // registros de vídeo: la PPU lee regs
    if (off === REG.RCNT) { e.serial.writeRcnt(v); return; }
    if (off === 0x128) { e.serial.writeSiocnt(v, e.now()); return; }
    if (off >= 0x120 && off < 0x15c) return; // resto del puerto serie: datos (sin aparato conectado)
    this.unknownWrites.set(off, (this.unknownWrites.get(off) || 0) + 1);
  }

  #halt(v) {
    // HALTCNT: bit 7 = 0 → Halt; 1 → Stop (se trata como Halt hasta la siguiente interrupción)
    this.emu.irq.halted = true;
    if (v & 0x80) this.emu.irq.stopped = true;
  }
}
