/**
 * Instrucciones ARM (32 bits) del ARM7TDMI.
 * Decodificación: tabla de 4096 entradas indexada por bits 27–20 y 7–4 del opcode.
 * Cada entrada es una función ya especializada (sin volver a decodificar el formato en ejecución).
 */
const MODE_USR = 0x10; // no se importa de arm7tdmi.js para evitar una dependencia circular

/** Desplazador de barril. Devuelve el resultado y deja el acarreo de salida en cpu.sc. */
export function shift(cpu, type, value, amount, byReg) {
  value >>>= 0;
  if (byReg) {
    amount &= 0xff;
    if (amount === 0) { cpu.sc = cpu.c; return value; }
    switch (type) {
      case 0: // LSL
        if (amount < 32) { cpu.sc = (value >>> (32 - amount)) & 1; return (value << amount) >>> 0; }
        cpu.sc = amount === 32 ? value & 1 : 0; return 0;
      case 1: // LSR
        if (amount < 32) { cpu.sc = (value >>> (amount - 1)) & 1; return value >>> amount; }
        cpu.sc = amount === 32 ? value >>> 31 : 0; return 0;
      case 2: // ASR
        if (amount < 32) { cpu.sc = (value >> (amount - 1)) & 1; return (value >> amount) >>> 0; }
        cpu.sc = value >>> 31; return cpu.sc ? 0xffffffff : 0;
      default: { // ROR
        const a = amount & 31;
        if (a === 0) { cpu.sc = value >>> 31; return value; }
        cpu.sc = (value >>> (a - 1)) & 1; return ((value >>> a) | (value << (32 - a))) >>> 0;
      }
    }
  }
  switch (type) {
    case 0:
      if (amount === 0) { cpu.sc = cpu.c; return value; }
      cpu.sc = (value >>> (32 - amount)) & 1; return (value << amount) >>> 0;
    case 1:
      if (amount === 0) { cpu.sc = value >>> 31; return 0; } // LSR #32
      cpu.sc = (value >>> (amount - 1)) & 1; return value >>> amount;
    case 2:
      if (amount === 0) { cpu.sc = value >>> 31; return cpu.sc ? 0xffffffff : 0; } // ASR #32
      cpu.sc = (value >> (amount - 1)) & 1; return (value >> amount) >>> 0;
    default:
      if (amount === 0) { cpu.sc = value & 1; return ((cpu.c << 31) | (value >>> 1)) >>> 0; } // RRX
      cpu.sc = (value >>> (amount - 1)) & 1; return ((value >>> amount) | (value << (32 - amount))) >>> 0;
  }
}

/** Suma con banderas: devuelve el resultado y fija C y V. */
export function addFlags(cpu, a, b, carryIn = 0) {
  const sum = a + b + carryIn;
  const res = sum >>> 0;
  cpu.c = sum > 0xffffffff ? 1 : 0;
  cpu.v = ((~(a ^ b) & (a ^ res)) >>> 31) & 1;
  return res;
}
/** Resta a − b − (1 − carryIn) con banderas (C = no hay préstamo). */
export function subFlags(cpu, a, b, carryIn = 1) {
  const borrow = 1 - carryIn;
  const res = (a - b - borrow) >>> 0;
  cpu.c = a >= b + borrow ? 1 : 0;
  cpu.v = (((a ^ b) & (a ^ res)) >>> 31) & 1;
  return res;
}
const setNZ = (cpu, v) => { cpu.n = v >>> 31; cpu.z = v === 0 ? 1 : 0; };

/** Lectura de 32 bits con rotación por desalineación (comportamiento de LDR en ARMv4). */
export function ldrRotated(bus, addr) {
  const v = bus.read32(addr);
  const rot = (addr & 3) * 8;
  return rot ? ((v >>> rot) | (v << (32 - rot))) >>> 0 : v;
}

/** Multiplicación 32×32→64 (con o sin signo) sin BigInt: devuelve [lo, hi]. */
export function mul64(a, b, signed) {
  let neg = false;
  if (signed) {
    if (a & 0x80000000) { a = (~a + 1) >>> 0; neg = !neg; }
    if (b & 0x80000000) { b = (~b + 1) >>> 0; neg = !neg; }
  }
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = p01 + p10; // < 2^33
  let lo = p00 + (mid % 0x10000) * 0x10000;
  let hi = p11 + Math.floor(mid / 0x10000) + Math.floor(lo / 0x100000000);
  lo = lo >>> 0; hi = hi >>> 0;
  if (neg) { lo = (~lo + 1) >>> 0; hi = (~hi + (lo === 0 ? 1 : 0)) >>> 0; }
  return [lo, hi];
}

export function buildArmTable(cpu) {
  const bus = cpu.bus, r = cpu.r;
  const table = new Array(4096);
  const und = (op) => cpu.undefined(op);

  // ------------------------------------------------------------ procesamiento de datos
  function dataProc(opcode, s, kind) {
    // kind: 0 = registro desplazado por inmediato, 1 = por registro, 2 = inmediato rotado
    return (op) => {
      const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
      let b;
      let a;
      if (kind === 2) {
        const rot = ((op >>> 8) & 15) * 2, imm = op & 0xff;
        b = rot ? ((imm >>> rot) | (imm << (32 - rot))) >>> 0 : imm;
        cpu.sc = rot ? b >>> 31 : cpu.c;
        a = r[rn];
      } else if (kind === 0) {
        b = shift(cpu, (op >>> 5) & 3, r[op & 15], (op >>> 7) & 31, false);
        a = r[rn];
      } else {
        // Desplazamiento por registro: un ciclo extra; PC se lee como dirección + 12
        cpu.cycles++;
        const rm = op & 15;
        const vm = rm === 15 ? r[15] + 4 : r[rm];
        b = shift(cpu, (op >>> 5) & 3, vm, r[(op >>> 8) & 15], true);
        a = rn === 15 ? r[15] + 4 : r[rn];
      }
      a >>>= 0;
      let res, write = true, logical = false;
      switch (opcode) {
        case 0x0: res = (a & b) >>> 0; logical = true; break;           // AND
        case 0x1: res = (a ^ b) >>> 0; logical = true; break;           // EOR
        case 0x2: res = s ? subFlags(cpu, a, b) : (a - b) >>> 0; break; // SUB
        case 0x3: res = s ? subFlags(cpu, b, a) : (b - a) >>> 0; break; // RSB
        case 0x4: res = s ? addFlags(cpu, a, b) : (a + b) >>> 0; break; // ADD
        case 0x5: res = s ? addFlags(cpu, a, b, cpu.c) : (a + b + cpu.c) >>> 0; break; // ADC
        case 0x6: res = s ? subFlags(cpu, a, b, cpu.c) : (a - b - (1 - cpu.c)) >>> 0; break; // SBC
        case 0x7: res = s ? subFlags(cpu, b, a, cpu.c) : (b - a - (1 - cpu.c)) >>> 0; break; // RSC
        case 0x8: res = (a & b) >>> 0; logical = true; write = false; break; // TST
        case 0x9: res = (a ^ b) >>> 0; logical = true; write = false; break; // TEQ
        case 0xa: res = subFlags(cpu, a, b); write = false; break;      // CMP
        case 0xb: res = addFlags(cpu, a, b); write = false; break;      // CMN
        case 0xc: res = (a | b) >>> 0; logical = true; break;           // ORR
        case 0xd: res = b; logical = true; break;                       // MOV
        case 0xe: res = (a & ~b) >>> 0; logical = true; break;          // BIC
        default: res = (~b) >>> 0; logical = true; break;               // MVN
      }
      if (s) {
        if (rd === 15 && write) {
          // MOVS/SUBS PC, ...: retorno de excepción, CPSR ← SPSR
          if (cpu.hasSpsr()) cpu.cpsr = cpu.spsr;
        } else {
          setNZ(cpu, res);
          if (logical) cpu.c = cpu.sc;
        }
      }
      if (write) {
        if (rd === 15) { cpu.branch(res); cpu.cycles += 2; } else r[rd] = res;
      }
    };
  }

  // ------------------------------------------------------------ PSR
  const mrs = (useSpsr) => (op) => { r[(op >>> 12) & 15] = useSpsr ? cpu.spsr : cpu.cpsr; };
  const msr = (useSpsr, imm) => (op) => {
    let v;
    if (imm) { const rot = ((op >>> 8) & 15) * 2, i = op & 0xff; v = rot ? ((i >>> rot) | (i << (32 - rot))) >>> 0 : i; }
    else v = r[op & 15];
    let mask = 0;
    if (op & (1 << 19)) mask |= 0xff000000;
    if (op & (1 << 16)) mask |= 0x000000ff;
    if (op & (1 << 17)) mask |= 0x0000ff00;
    if (op & (1 << 18)) mask |= 0x00ff0000;
    if (useSpsr) { if (cpu.hasSpsr()) cpu.spsr = ((cpu.spsr & ~mask) | (v & mask)) >>> 0; return; }
    if (cpu.mode === MODE_USR) mask &= 0xff000000; // en modo usuario solo se escriben las banderas
    const nv = ((cpu.cpsr & ~mask) | (v & mask)) >>> 0;
    const t = cpu.t;
    cpu.cpsr = nv;
    cpu.t = t; // MSR no cambia el estado Thumb
  };

  // ------------------------------------------------------------ multiplicaciones
  const mul = (accumulate, s) => (op) => {
    const rd = (op >>> 16) & 15, rn = (op >>> 12) & 15, rs = (op >>> 8) & 15, rm = op & 15;
    let res = Math.imul(r[rm], r[rs]);
    if (accumulate) res = (res + r[rn]) | 0;
    res >>>= 0;
    r[rd] = res;
    cpu.cycles += accumulate ? 3 : 2;
    if (s) setNZ(cpu, res);
  };
  const mull = (signed, accumulate, s) => (op) => {
    const rdHi = (op >>> 16) & 15, rdLo = (op >>> 12) & 15, rs = (op >>> 8) & 15, rm = op & 15;
    let [lo, hi] = mul64(r[rm], r[rs], signed);
    if (accumulate) {
      const sumLo = lo + r[rdLo];
      lo = sumLo >>> 0;
      hi = (hi + r[rdHi] + (sumLo > 0xffffffff ? 1 : 0)) >>> 0;
    }
    r[rdLo] = lo; r[rdHi] = hi;
    cpu.cycles += accumulate ? 4 : 3;
    if (s) { cpu.n = hi >>> 31; cpu.z = lo === 0 && hi === 0 ? 1 : 0; }
  };

  // ------------------------------------------------------------ SWP
  const swp = (byte) => (op) => {
    const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15, rm = op & 15;
    const addr = r[rn], src = r[rm];
    if (byte) { const t = bus.read8(addr); bus.write8(addr, src & 0xff); r[rd] = t; }
    else { const t = ldrRotated(bus, addr); bus.write32(addr, src); r[rd] = t; }
    cpu.cycles += 3;
  };

  // ------------------------------------------------------------ BX
  const bx = (op) => {
    const v = r[op & 15];
    cpu.t = v & 1;
    cpu.branch(v);
    cpu.cycles += 2;
  };

  // ------------------------------------------------------------ transferencias de halfword / con signo
  const halfword = (p, u, immOff, w, l, sh) => (op) => {
    const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
    const offset = immOff ? ((op >>> 4) & 0xf0) | (op & 15) : r[op & 15];
    const base = r[rn];
    const addr = p ? (u ? base + offset : base - offset) >>> 0 : base;
    const wbAddr = (u ? base + offset : base - offset) >>> 0;
    if (l) {
      let v;
      if (sh === 1) { // LDRH (desalineado: rota 8 bits)
        v = bus.read16(addr);
        if (addr & 1) v = ((v >>> 8) | (v << 24)) >>> 0;
      } else if (sh === 2) { v = (bus.read8(addr) << 24) >> 24 >>> 0; } // LDRSB
      else { // LDRSH (desalineado: se comporta como LDRSB)
        v = (addr & 1) ? ((bus.read8(addr) << 24) >> 24) >>> 0 : ((bus.read16(addr) << 16) >> 16) >>> 0;
      }
      if (!p || w) r[rn] = wbAddr;
      if (rd === 15) { cpu.branch(v); cpu.cycles += 2; } else r[rd] = v;
      cpu.cycles += 2 + bus.wait16[addr >>> 24 & 15];
    } else {
      const v = rd === 15 ? r[15] + 4 : r[rd];
      bus.write16(addr, v & 0xffff);
      if (!p || w) r[rn] = wbAddr;
      cpu.cycles += 1 + bus.wait16[addr >>> 24 & 15];
    }
  };

  // ------------------------------------------------------------ LDR/STR
  const single = (regOff, p, u, byte, w, l) => (op) => {
    const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
    let offset;
    if (regOff) {
      offset = shift(cpu, (op >>> 5) & 3, r[op & 15], (op >>> 7) & 31, false);
    } else offset = op & 0xfff;
    const base = r[rn];
    const wbAddr = (u ? base + offset : base - offset) >>> 0;
    const addr = p ? wbAddr : base;
    if (l) {
      const v = byte ? bus.read8(addr) : ldrRotated(bus, addr);
      if (!p || w) r[rn] = wbAddr;
      if (rd === 15) { cpu.branch(v); cpu.cycles += 2; } else r[rd] = v;
      cpu.cycles += 2 + bus.wait32[addr >>> 24 & 15];
    } else {
      const v = rd === 15 ? r[15] + 4 : r[rd];
      if (byte) bus.write8(addr, v & 0xff); else bus.write32(addr, v);
      if (!p || w) r[rn] = wbAddr;
      cpu.cycles += 1 + bus.wait32[addr >>> 24 & 15];
    }
  };

  // ------------------------------------------------------------ LDM/STM
  const block = (p, u, s, w, l) => (op) => {
    const rn = (op >>> 16) & 15;
    let list = op & 0xffff;
    let count = 0;
    for (let k = 0; k < 16; k++) if (list & (1 << k)) count++;
    let empty = false;
    if (list === 0) { list = 0x8000; count = 16; empty = true; } // ARMv4: lista vacía → r15, base ± 0x40
    const base = r[rn];
    let addr;
    if (u) addr = p ? base + 4 : base;
    else addr = p ? base - count * 4 : base - count * 4 + 4;
    addr >>>= 0;
    const newBase = (u ? base + count * 4 : base - count * 4) >>> 0;
    const userBank = s && !(l && (list & 0x8000));
    cpu.cycles += count + 1;
    if (l) {
      if (w) r[rn] = newBase;
      for (let k = 0; k < 16; k++) {
        if (!(list & (1 << k))) continue;
        const v = bus.read32(addr);
        addr = (addr + 4) >>> 0;
        if (k === 15) {
          if (s && cpu.hasSpsr()) cpu.cpsr = cpu.spsr; // LDM ^ con PC: retorno de excepción
          cpu.branch(v); cpu.cycles += 2;
        } else if (userBank) cpu.setUserReg(k, v);
        else r[k] = v;
      }
    } else {
      let first = true;
      for (let k = 0; k < 16; k++) {
        if (!(list & (1 << k))) continue;
        let v;
        if (k === 15) v = r[15] + 4;
        else if (k === rn && !first && w) v = newBase; // base no primera: se guarda el valor nuevo
        else v = userBank ? cpu.getUserReg(k) : r[k];
        bus.write32(addr, v);
        addr = (addr + 4) >>> 0;
        first = false;
      }
      if (w) r[rn] = newBase;
    }
    if (empty) r[rn] = (u ? base + 0x40 : base - 0x40) >>> 0;
  };

  // ------------------------------------------------------------ saltos
  const b = (link) => (op) => {
    const off = (op << 8) >> 6; // 24 bits con signo × 4
    if (link) r[14] = cpu.next;
    cpu.branch(r[15] + off);
    cpu.cycles += 2;
  };
  const swi = (op) => { cpu.cycles += 2; cpu.swi((op >>> 16) & 0xff); };

  // ------------------------------------------------------------ construcción de la tabla
  for (let i = 0; i < 4096; i++) {
    const hi = i >>> 4, lo = i & 15; // hi = bits 27–20, lo = bits 7–4
    const top = hi >>> 5;            // bits 27–25
    let h = und;
    if (top === 0) {
      if (lo === 9) {
        if ((hi & 0xfc) === 0x00) h = mul((hi & 2) !== 0, (hi & 1) !== 0);
        else if ((hi & 0xf8) === 0x08) h = mull((hi & 4) !== 0, (hi & 2) !== 0, (hi & 1) !== 0);
        else if ((hi & 0xfb) === 0x10) h = swp((hi & 4) !== 0);
      } else if ((lo & 9) === 9) {
        const sh = (lo >>> 1) & 3;
        const l = (hi & 1) !== 0;
        if (sh !== 0 && !(!l && sh !== 1)) h = halfword((hi & 0x10) !== 0, (hi & 8) !== 0, (hi & 4) !== 0, (hi & 2) !== 0, l, sh);
        else if (sh === 1) h = halfword((hi & 0x10) !== 0, (hi & 8) !== 0, (hi & 4) !== 0, (hi & 2) !== 0, l, sh);
      } else if (hi === 0x12 && lo === 1) h = bx;
      else if ((hi & 0xfb) === 0x10 && lo === 0) h = mrs((hi & 4) !== 0);
      else if ((hi & 0xfb) === 0x12 && lo === 0) h = msr((hi & 4) !== 0, false);
      else {
        const opcode = (hi >>> 1) & 15, s = (hi & 1) !== 0;
        if (opcode >= 8 && opcode <= 11 && !s) h = und;
        else h = dataProc(opcode, s, (lo & 1) ? 1 : 0);
      }
    } else if (top === 1) {
      const opcode = (hi >>> 1) & 15, s = (hi & 1) !== 0;
      if ((hi & 0xfb) === 0x32) h = msr((hi & 4) !== 0, true);
      else if (opcode >= 8 && opcode <= 11 && !s) h = und;
      else h = dataProc(opcode, s, 2);
    } else if (top === 2 || top === 3) {
      if (top === 3 && (lo & 1)) h = und;
      else h = single(top === 3, (hi & 0x10) !== 0, (hi & 8) !== 0, (hi & 4) !== 0, (hi & 2) !== 0, (hi & 1) !== 0);
    } else if (top === 4) h = block((hi & 0x10) !== 0, (hi & 8) !== 0, (hi & 4) !== 0, (hi & 2) !== 0, (hi & 1) !== 0);
    else if (top === 5) h = b((hi & 0x10) !== 0);
    else if (top === 7 && (hi & 0x10)) h = swi;
    else h = und; // coprocesador: no existe en el GBA
    table[i] = h;
  }
  return table;
}
