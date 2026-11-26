/**
 * Instrucciones Thumb (16 bits) del ARM7TDMI: los 19 formatos del manual de ARM.
 * Tabla de 1024 entradas indexada por los bits 15–6 del opcode.
 */
import { shift, addFlags, subFlags, ldrRotated } from './arm.js';

export function buildThumbTable(cpu) {
  const bus = cpu.bus, r = cpu.r;
  const table = new Array(1024);
  const setNZ = (v) => { cpu.n = v >>> 31; cpu.z = v === 0 ? 1 : 0; };
  const und = (op) => cpu.undefined(op);
  const w16 = bus.wait16, w32 = bus.wait32;

  // Formato 1: LSL/LSR/ASR Rd, Rs, #imm5
  const shiftImm = (type) => (op) => {
    const rd = op & 7, rs = (op >>> 3) & 7, amt = (op >>> 6) & 31;
    const v = shift(cpu, type, r[rs], amt, false);
    cpu.c = cpu.sc; r[rd] = v; setNZ(v);
  };
  // Formato 2: ADD/SUB Rd, Rs, Rn | #imm3
  const addSub = (imm, sub) => (op) => {
    const rd = op & 7, rs = (op >>> 3) & 7, x = (op >>> 6) & 7;
    const b = imm ? x : r[x];
    const v = sub ? subFlags(cpu, r[rs], b) : addFlags(cpu, r[rs], b);
    r[rd] = v; setNZ(v);
  };
  // Formato 3: MOV/CMP/ADD/SUB Rd, #imm8
  const imm8 = (kind, rd) => (op) => {
    const imm = op & 0xff;
    switch (kind) {
      case 0: r[rd] = imm; setNZ(imm); break;
      case 1: setNZ(subFlags(cpu, r[rd], imm)); break;
      case 2: { const v = addFlags(cpu, r[rd], imm); r[rd] = v; setNZ(v); break; }
      default: { const v = subFlags(cpu, r[rd], imm); r[rd] = v; setNZ(v); break; }
    }
  };
  // Formato 4: operaciones de la ALU
  const alu = (kind) => (op) => {
    const rd = op & 7, rs = (op >>> 3) & 7;
    const a = r[rd], b = r[rs];
    let v;
    switch (kind) {
      case 0x0: v = (a & b) >>> 0; r[rd] = v; setNZ(v); break;                  // AND
      case 0x1: v = (a ^ b) >>> 0; r[rd] = v; setNZ(v); break;                  // EOR
      case 0x2: v = shift(cpu, 0, a, b, true); cpu.c = cpu.sc; r[rd] = v; setNZ(v); cpu.cycles++; break; // LSL
      case 0x3: v = shift(cpu, 1, a, b, true); cpu.c = cpu.sc; r[rd] = v; setNZ(v); cpu.cycles++; break; // LSR
      case 0x4: v = shift(cpu, 2, a, b, true); cpu.c = cpu.sc; r[rd] = v; setNZ(v); cpu.cycles++; break; // ASR
      case 0x5: v = addFlags(cpu, a, b, cpu.c); r[rd] = v; setNZ(v); break;     // ADC
      case 0x6: v = subFlags(cpu, a, b, cpu.c); r[rd] = v; setNZ(v); break;     // SBC
      case 0x7: v = shift(cpu, 3, a, b, true); cpu.c = cpu.sc; r[rd] = v; setNZ(v); cpu.cycles++; break; // ROR
      case 0x8: setNZ((a & b) >>> 0); break;                                     // TST
      case 0x9: v = subFlags(cpu, 0, b); r[rd] = v; setNZ(v); break;            // NEG
      case 0xa: setNZ(subFlags(cpu, a, b)); break;                               // CMP
      case 0xb: setNZ(addFlags(cpu, a, b)); break;                               // CMN
      case 0xc: v = (a | b) >>> 0; r[rd] = v; setNZ(v); break;                  // ORR
      case 0xd: v = Math.imul(a, b) >>> 0; r[rd] = v; setNZ(v); cpu.cycles += 2; break; // MUL
      case 0xe: v = (a & ~b) >>> 0; r[rd] = v; setNZ(v); break;                 // BIC
      default: v = (~b) >>> 0; r[rd] = v; setNZ(v); break;                      // MVN
    }
  };
  // Formato 5: registros altos y BX
  const hiReg = (kind) => (op) => {
    const rd = (op & 7) | ((op >>> 4) & 8), rs = (op >>> 3) & 15;
    const b = r[rs];
    switch (kind) {
      case 0: { // ADD
        const v = (r[rd] + b) >>> 0;
        if (rd === 15) { cpu.branch(v); cpu.cycles += 2; } else r[rd] = v;
        break;
      }
      case 1: setNZ(subFlags(cpu, r[rd], b)); break; // CMP
      case 2: if (rd === 15) { cpu.branch(b); cpu.cycles += 2; } else r[rd] = b; break; // MOV
      default: { // BX
        cpu.t = b & 1;
        cpu.branch(b);
        cpu.cycles += 2;
        break;
      }
    }
  };
  // Formato 6: LDR Rd, [PC, #imm8×4]
  const ldrPc = (rd) => (op) => {
    const addr = ((r[15] & ~2) + (op & 0xff) * 4) >>> 0;
    r[rd] = bus.read32(addr);
    cpu.cycles += 2 + w32[addr >>> 24 & 15];
  };
  // Formatos 7 y 8: transferencias con desplazamiento en registro
  const regOff = (kind) => (op) => {
    const rd = op & 7, rb = (op >>> 3) & 7, ro = (op >>> 6) & 7;
    const addr = (r[rb] + r[ro]) >>> 0;
    const w = w16[addr >>> 24 & 15];
    // kind = bits 11–9. Formato 7 (bit 9 = 0): L (11), B (10). Formato 8 (bit 9 = 1): H (11), S (10).
    switch (kind) {
      case 0: bus.write32(addr, r[rd]); cpu.cycles += w + 1; break;                 // STR
      case 1: bus.write16(addr, r[rd] & 0xffff); cpu.cycles += w; break;             // STRH
      case 2: bus.write8(addr, r[rd] & 0xff); cpu.cycles += w; break;                // STRB
      case 3: r[rd] = ((bus.read8(addr) << 24) >> 24) >>> 0; cpu.cycles += w + 1; break; // LDSB
      case 4: r[rd] = ldrRotated(bus, addr); cpu.cycles += w + 2; break;            // LDR
      case 5: { let v = bus.read16(addr); if (addr & 1) v = ((v >>> 8) | (v << 24)) >>> 0; r[rd] = v; cpu.cycles += w + 1; break; } // LDRH
      case 6: r[rd] = bus.read8(addr); cpu.cycles += w + 1; break;                   // LDRB
      default: r[rd] = (addr & 1) ? ((bus.read8(addr) << 24) >> 24) >>> 0 : ((bus.read16(addr) << 16) >> 16) >>> 0; cpu.cycles += w + 1; break; // LDSH
    }
  };
  // Formato 9: LDR/STR con inmediato (palabra ×4 o byte)
  const immOff = (byte, load) => (op) => {
    const rd = op & 7, rb = (op >>> 3) & 7, imm = (op >>> 6) & 31;
    const addr = (r[rb] + (byte ? imm : imm * 4)) >>> 0;
    const w = w16[addr >>> 24 & 15];
    if (load) { r[rd] = byte ? bus.read8(addr) : ldrRotated(bus, addr); cpu.cycles += w + 2; }
    else { if (byte) bus.write8(addr, r[rd] & 0xff); else bus.write32(addr, r[rd]); cpu.cycles += w + 1; }
  };
  // Formato 10: LDRH/STRH con inmediato ×2
  const halfImm = (load) => (op) => {
    const rd = op & 7, rb = (op >>> 3) & 7;
    const addr = (r[rb] + ((op >>> 6) & 31) * 2) >>> 0;
    if (load) { let v = bus.read16(addr); if (addr & 1) v = ((v >>> 8) | (v << 24)) >>> 0; r[rd] = v; cpu.cycles += 2; }
    else { bus.write16(addr, r[rd] & 0xffff); cpu.cycles += 1; }
  };
  // Formato 11: LDR/STR relativo a SP
  const spRel = (load, rd) => (op) => {
    const addr = (r[13] + (op & 0xff) * 4) >>> 0;
    if (load) { r[rd] = ldrRotated(bus, addr); cpu.cycles += 2; } else { bus.write32(addr, r[rd]); cpu.cycles += 1; }
  };
  // Formato 12: ADD Rd, PC|SP, #imm8×4
  const loadAddr = (sp, rd) => (op) => { r[rd] = sp ? (r[13] + (op & 0xff) * 4) >>> 0 : ((r[15] & ~2) + (op & 0xff) * 4) >>> 0; };
  // Formato 13: ADD SP, #±imm7×4
  const addSp = (op) => { const imm = (op & 0x7f) * 4; r[13] = (op & 0x80 ? r[13] - imm : r[13] + imm) >>> 0; };
  // Formato 14: PUSH/POP
  const pushPop = (pop, extra) => (op) => {
    const list = op & 0xff;
    if (pop) {
      let addr = r[13];
      for (let k = 0; k < 8; k++) if (list & (1 << k)) { r[k] = bus.read32(addr); addr = (addr + 4) >>> 0; cpu.cycles++; }
      if (extra) { const v = bus.read32(addr); addr = (addr + 4) >>> 0; cpu.branch(v); cpu.cycles += 3; }
      if (!list && !extra) addr = (addr + 0x40) >>> 0;
      r[13] = addr;
    } else {
      let count = extra ? 1 : 0;
      for (let k = 0; k < 8; k++) if (list & (1 << k)) count++;
      let addr = (r[13] - count * 4) >>> 0;
      r[13] = addr;
      for (let k = 0; k < 8; k++) if (list & (1 << k)) { bus.write32(addr, r[k]); addr = (addr + 4) >>> 0; cpu.cycles++; }
      if (extra) bus.write32(addr, r[14]);
      if (!list && !extra) r[13] = (r[13] - 0x40) >>> 0;
    }
  };
  // Formato 15: STMIA/LDMIA Rb!, {lista}
  const multiple = (load, rb) => (op) => {
    const list = op & 0xff;
    let addr = r[rb];
    if (!list) { // lista vacía: transfiere r15 y base += 0x40 (ARMv4)
      if (load) cpu.branch(bus.read32(addr)); else bus.write32(addr, r[15] + 2);
      r[rb] = (addr + 0x40) >>> 0; return;
    }
    let count = 0; for (let k = 0; k < 8; k++) if (list & (1 << k)) count++;
    const end = (addr + count * 4) >>> 0;
    if (load) {
      for (let k = 0; k < 8; k++) if (list & (1 << k)) { r[k] = bus.read32(addr); addr = (addr + 4) >>> 0; cpu.cycles++; }
      if (!(list & (1 << rb))) r[rb] = end;
    } else {
      let first = true;
      for (let k = 0; k < 8; k++) if (list & (1 << k)) {
        bus.write32(addr, k === rb && !first ? end : r[k]);
        addr = (addr + 4) >>> 0; cpu.cycles++; first = false;
      }
      r[rb] = end;
    }
  };
  // Formato 16: salto condicional; 17: SWI
  const bcond = (cond) => (op) => {
    if (!cpu.cond(cond)) return;
    cpu.branch(r[15] + (((op & 0xff) << 24) >> 23));
    cpu.cycles += 2;
  };
  const swi = (op) => { cpu.cycles += 2; cpu.swi(op & 0xff); };
  // Formato 18: B incondicional
  const b = (op) => { cpu.branch(r[15] + (((op & 0x7ff) << 21) >> 20)); cpu.cycles += 2; };
  // Formato 19: BL (dos mitades)
  const blHi = (op) => { r[14] = (r[15] + (((op & 0x7ff) << 21) >> 9)) >>> 0; };
  const blLo = (op) => {
    const ret = cpu.next | 1;
    cpu.branch(r[14] + (op & 0x7ff) * 2);
    r[14] = ret >>> 0;
    cpu.cycles += 2;
  };

  for (let i = 0; i < 1024; i++) {
    const op = i << 6; // bits 15–6
    let h = und;
    if ((op & 0xf800) < 0x1800) h = shiftImm((op >>> 11) & 3);
    else if ((op & 0xf800) === 0x1800) h = addSub((op & 0x400) !== 0, (op & 0x200) !== 0);
    else if ((op & 0xe000) === 0x2000) h = imm8((op >>> 11) & 3, (op >>> 8) & 7);
    else if ((op & 0xfc00) === 0x4000) h = alu((op >>> 6) & 15);
    else if ((op & 0xfc00) === 0x4400) h = hiReg((op >>> 8) & 3);
    else if ((op & 0xf800) === 0x4800) h = ldrPc((op >>> 8) & 7);
    else if ((op & 0xf000) === 0x5000) h = regOff((op >>> 9) & 7);
    else if ((op & 0xe000) === 0x6000) h = immOff((op & 0x1000) !== 0, (op & 0x800) !== 0);
    else if ((op & 0xf000) === 0x8000) h = halfImm((op & 0x800) !== 0);
    else if ((op & 0xf000) === 0x9000) h = spRel((op & 0x800) !== 0, (op >>> 8) & 7);
    else if ((op & 0xf000) === 0xa000) h = loadAddr((op & 0x800) !== 0, (op >>> 8) & 7);
    else if ((op & 0xff00) === 0xb000) h = addSp;
    else if ((op & 0xf600) === 0xb400) h = pushPop((op & 0x800) !== 0, (op & 0x100) !== 0);
    else if ((op & 0xf000) === 0xc000) h = multiple((op & 0x800) !== 0, (op >>> 8) & 7);
    else if ((op & 0xff00) === 0xdf00) h = swi;
    else if ((op & 0xff00) === 0xde00) h = und;
    else if ((op & 0xf000) === 0xd000) h = bcond((op >>> 8) & 15);
    else if ((op & 0xf800) === 0xe000) h = b;
    else if ((op & 0xf800) === 0xf000) h = blHi;
    else if ((op & 0xf800) === 0xf800) h = blLo;
    table[i] = h;
  }
  return table;
}
