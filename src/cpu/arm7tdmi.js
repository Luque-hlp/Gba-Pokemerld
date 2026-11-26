/**
 * Núcleo ARM7TDMI (ARMv4T). Referencias: ARM7TDMI Technical Reference Manual y GBATEK ("ARM CPU").
 *
 * Modelo de PC: mientras se ejecuta una instrucción, r[15] vale dirección + 8 (ARM) o + 4 (Thumb),
 * como ve el programa en el hardware real por la segmentación. `next` es la dirección de la siguiente
 * instrucción; escribir en r15 se hace siempre con branch(), que actualiza `next`.
 *
 * Modos y bancos: usr/sys comparten registros; fiq tiene r8–r14 propios; irq, svc, abt y und tienen
 * r13–r14 y SPSR propios.
 */
import { buildArmTable } from './arm.js';
import { buildThumbTable } from './thumb.js';

export const MODE = Object.freeze({ USR: 0x10, FIQ: 0x11, IRQ: 0x12, SVC: 0x13, ABT: 0x17, UND: 0x1b, SYS: 0x1f });
const BANK = { 0x10: 0, 0x1f: 0, 0x11: 1, 0x12: 2, 0x13: 3, 0x17: 4, 0x1b: 5 };

export class ARM7TDMI {
  constructor(bus) {
    this.bus = bus;
    bus.cpu = this;
    this.r = new Uint32Array(16);
    this.bankR13 = new Uint32Array(6); this.bankR14 = new Uint32Array(6); this.bankSpsr = new Uint32Array(6);
    this.fiqR = new Uint32Array(5); this.usrR = new Uint32Array(5);
    this.n = 0; this.z = 0; this.c = 0; this.v = 0; this.i = 0; this.f = 0; this.t = 0; this.mode = MODE.SYS;
    this.next = 0;          // dirección de la siguiente instrucción
    this.cycles = 0;        // ciclos consumidos (los suma el bucle de ejecución)
    this.swiHandler = null; // HLE de la BIOS: (n) => void
    this.undefinedHandler = null;
    this.irq = null;        // Interrupts
    this.trace = null;      // depuración: (pc, op, thumb) => void
    this.armTable = buildArmTable(this);
    this.thumbTable = buildThumbTable(this);
  }

  // ---------------------------------------------------------------- estado
  get cpsr() {
    return ((this.n << 31) | (this.z << 30) | (this.c << 29) | (this.v << 28) | (this.i << 7) | (this.f << 6) | (this.t << 5) | this.mode) >>> 0;
  }
  set cpsr(v) {
    this.n = (v >>> 31) & 1; this.z = (v >>> 30) & 1; this.c = (v >>> 29) & 1; this.v = (v >>> 28) & 1;
    this.i = (v >>> 7) & 1; this.f = (v >>> 6) & 1; this.t = (v >>> 5) & 1;
    this.switchMode(v & 0x1f);
  }
  get spsr() { const b = BANK[this.mode]; return b ? this.bankSpsr[b] : this.cpsr; }
  set spsr(v) { const b = BANK[this.mode]; if (b) this.bankSpsr[b] = v >>> 0; }
  hasSpsr() { return BANK[this.mode] > 0; }

  switchMode(newMode) {
    if (BANK[newMode] === undefined) newMode = MODE.SYS; // modo inválido: se trata como sistema
    const oldMode = this.mode;
    if (oldMode === newMode) return;
    const ob = BANK[oldMode], nb = BANK[newMode];
    if (ob !== nb) {
      this.bankR13[ob] = this.r[13]; this.bankR14[ob] = this.r[14];
      if (oldMode === MODE.FIQ) for (let k = 0; k < 5; k++) { this.fiqR[k] = this.r[8 + k]; this.r[8 + k] = this.usrR[k]; }
      if (newMode === MODE.FIQ) for (let k = 0; k < 5; k++) { this.usrR[k] = this.r[8 + k]; this.r[8 + k] = this.fiqR[k]; }
      this.r[13] = this.bankR13[nb]; this.r[14] = this.bankR14[nb];
    }
    this.mode = newMode;
  }

  /** Registro de usuario (para LDM/STM con el bit S). */
  getUserReg(n) {
    if (n < 8 || n === 15) return this.r[n];
    if (n < 13) return this.mode === MODE.FIQ ? this.usrR[n - 8] : this.r[n];
    if (BANK[this.mode] === 0) return this.r[n];
    return n === 13 ? this.bankR13[0] : this.bankR14[0];
  }
  setUserReg(n, v) {
    if (n < 8 || n === 15) { this.r[n] = v; return; }
    if (n < 13) { if (this.mode === MODE.FIQ) this.usrR[n - 8] = v; else this.r[n] = v; return; }
    if (BANK[this.mode] === 0) { this.r[n] = v; return; }
    if (n === 13) this.bankR13[0] = v; else this.bankR14[0] = v;
  }

  /** Estado tras el arranque de la BIOS (GBATEK, "BIOS RAM Usage"; pilas en IWRAM). */
  resetToRom(entry = 0x08000000) {
    this.r.fill(0);
    this.bankR13.fill(0); this.bankR14.fill(0); this.bankSpsr.fill(0);
    this.mode = MODE.SVC; this.r[13] = 0x03007fe0;
    this.switchMode(MODE.IRQ); this.r[13] = 0x03007fa0;
    this.switchMode(MODE.SYS); this.r[13] = 0x03007f00;
    this.n = this.z = this.c = this.v = 0; this.i = 0; this.f = 0; this.t = 0;
    this.branch(entry);
  }

  pcInBios() { return this.next < 0x4000 + 8; }

  /** Salto: fija la siguiente instrucción (alineada según el estado). */
  branch(addr) {
    addr >>>= 0;
    this.next = this.t ? addr & ~1 : addr & ~3;
    this.r[15] = this.next;
  }

  // ---------------------------------------------------------------- excepciones
  /** Excepción genérica: guarda CPSR en SPSR, cambia de modo, LR = dirección de retorno. */
  exception(mode, vector, lr) {
    const old = this.cpsr;
    this.switchMode(mode);
    this.bankSpsr[BANK[mode]] = old;
    this.r[14] = lr >>> 0;
    this.t = 0; this.i = 1;
    if (mode === MODE.FIQ) this.f = 1;
    this.branch(vector);
  }
  /** IRQ: el manejador vuelve con SUBS PC, LR, #4, así que LR = siguiente instrucción + 4. */
  raiseIrq() { this.exception(MODE.IRQ, 0x18, this.next + 4); }

  swi(n) {
    if (this.swiHandler) { this.swiHandler(n); return; }
    this.exception(MODE.SVC, 0x08, this.next);
  }
  undefined(op) {
    this.undefinedHandler?.(op, this.t ? this.next - 2 : this.next - 4, this.t);
    this.exception(MODE.UND, 0x04, this.next);
  }

  // ---------------------------------------------------------------- condición
  cond(c) {
    switch (c) {
      case 0x0: return this.z === 1;
      case 0x1: return this.z === 0;
      case 0x2: return this.c === 1;
      case 0x3: return this.c === 0;
      case 0x4: return this.n === 1;
      case 0x5: return this.n === 0;
      case 0x6: return this.v === 1;
      case 0x7: return this.v === 0;
      case 0x8: return this.c === 1 && this.z === 0;
      case 0x9: return this.c === 0 || this.z === 1;
      case 0xa: return this.n === this.v;
      case 0xb: return this.n !== this.v;
      case 0xc: return this.z === 0 && this.n === this.v;
      case 0xd: return this.z === 1 || this.n !== this.v;
      case 0xe: return true;
      default: return false; // 0xF: "nunca" en ARMv4
    }
  }

  // ---------------------------------------------------------------- ejecución
  /**
   * Ejecuta instrucciones hasta consumir `budget` ciclos o quedar en HALT.
   * Devuelve los ciclos realmente consumidos.
   */
  run(budget) {
    const bus = this.bus, irq = this.irq;
    const start = this.cycles, limit = start + budget;
    const w16 = bus.wait16, w32 = bus.wait32;
    const rom16 = bus.rom16, rom32 = bus.rom32, iw16 = bus.v16.iwram, iw32 = bus.v32.iwram;
    const thumbT = this.thumbTable, armT = this.armTable, r = this.r;
    while (this.cycles < limit) {
      if (irq.halted) { this.cycles = limit; break; }
      if (this.i === 0 && (irq.ime & 1) && (irq.ie & irq.if)) this.raiseIrq();
      const pc = this.next, region = pc >>> 24;
      if (this.t) {
        let op;
        if (region === 8 || region === 9) op = rom16[(pc & 0x1ffffff) >>> 1];
        else if (region === 3) op = iw16[(pc & 0x7fff) >>> 1];
        else op = bus.read16(pc);
        bus.openBus = op * 0x10001;
        r[15] = pc + 4; this.next = pc + 2;
        this.cycles += w16[region & 15];
        if (this.trace) this.trace(pc, op, 1);
        thumbT[op >>> 6](op);
      } else {
        let op;
        if (region === 8 || region === 9) op = rom32[(pc & 0x1ffffff) >>> 2];
        else if (region === 3) op = iw32[(pc & 0x7fff) >>> 2];
        else op = bus.read32(pc);
        if (region === 0) bus.biosLatch = op;
        bus.openBus = op;
        r[15] = pc + 8; this.next = pc + 4;
        this.cycles += w32[region & 15];
        if (this.trace) this.trace(pc, op, 0);
        const c = op >>> 28;
        if (c !== 0xe && !this.cond(c)) continue;
        armT[((op >>> 16) & 0xff0) | ((op >>> 4) & 0xf)](op);
      }
    }
    return this.cycles - start;
  }

  /** Ejecuta exactamente una instrucción (depuración y pruebas). */
  step() { const c = this.cycles; this.run(1); return this.cycles - c; }
}
