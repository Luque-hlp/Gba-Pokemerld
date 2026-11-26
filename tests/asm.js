/** Ensamblador mínimo para pruebas (codificación según el manual ARM7TDMI). */
export const AL = 0xe;
export const arm = {
  dpImm: (op, s, rd, rn, imm8, rot = 0, cond = AL) => ((cond << 28) | (1 << 25) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (rot << 8) | imm8) >>> 0,
  dpReg: (op, s, rd, rn, rm, type = 0, amt = 0, cond = AL) => ((cond << 28) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (amt << 7) | (type << 5) | rm) >>> 0,
  dpRegReg: (op, s, rd, rn, rm, type, rs, cond = AL) => ((cond << 28) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (rs << 8) | (type << 5) | 0x10 | rm) >>> 0,
  ldrImm: (l, b, rd, rn, off, { p = 1, u = 1, w = 0 } = {}) => ((AL << 28) | (1 << 26) | (p << 24) | (u << 23) | (b << 22) | (w << 21) | (l << 20) | (rn << 16) | (rd << 12) | off) >>> 0,
  half: (l, sh, rd, rn, off, { p = 1, u = 1, w = 0 } = {}) => ((AL << 28) | (p << 24) | (u << 23) | (1 << 22) | (w << 21) | (l << 20) | (rn << 16) | (rd << 12) | ((off >> 4) << 8) | (1 << 7) | (sh << 5) | (1 << 4) | (off & 15)) >>> 0,
  block: (l, rn, list, { p = 0, u = 1, s = 0, w = 1 } = {}) => ((AL << 28) | (4 << 25) | (p << 24) | (u << 23) | (s << 22) | (w << 21) | (l << 20) | (rn << 16) | list) >>> 0,
  b: (offWords, link = 0, cond = AL) => ((cond << 28) | (5 << 25) | (link << 24) | (offWords & 0xffffff)) >>> 0,
  bx: (rm) => (0xe12fff10 | rm) >>> 0,
  mul: (rd, rm, rs, { a = 0, s = 0, rn = 0 } = {}) => ((AL << 28) | (a << 21) | (s << 20) | (rd << 16) | (rn << 12) | (rs << 8) | 0x90 | rm) >>> 0,
  mull: (rdHi, rdLo, rm, rs, { signed = 0, a = 0, s = 0 } = {}) => ((AL << 28) | (1 << 23) | (signed << 22) | (a << 21) | (s << 20) | (rdHi << 16) | (rdLo << 12) | (rs << 8) | 0x90 | rm) >>> 0,
  mrs: (rd, spsr = 0) => ((AL << 28) | (0x10 << 20) | (spsr << 22) | (15 << 16) | (rd << 12)) >>> 0,
  msrReg: (rm, mask, spsr = 0) => ((AL << 28) | (0x12 << 20) | (spsr << 22) | (mask << 16) | (15 << 12) | rm) >>> 0,
  swp: (rd, rm, rn, b = 0) => ((AL << 28) | (0x10 << 20) | (b << 22) | (rn << 16) | (rd << 12) | 0x90 | rm) >>> 0,
  swi: (n) => ((AL << 28) | (0xf << 24) | (n << 16)) >>> 0,
};
export const OP = { AND: 0, EOR: 1, SUB: 2, RSB: 3, ADD: 4, ADC: 5, SBC: 6, RSC: 7, TST: 8, TEQ: 9, CMP: 10, CMN: 11, ORR: 12, MOV: 13, BIC: 14, MVN: 15 };
export const thumb = {
  shift: (type, rd, rs, imm) => (type << 11) | (imm << 6) | (rs << 3) | rd,
  addSub: (sub, imm, rd, rs, rnOrImm) => 0x1800 | (imm << 10) | (sub << 9) | (rnOrImm << 6) | (rs << 3) | rd,
  imm8: (op, rd, imm) => 0x2000 | (op << 11) | (rd << 8) | imm,
  alu: (op, rd, rs) => 0x4000 | (op << 6) | (rs << 3) | rd,
  hi: (op, rd, rs) => 0x4400 | (op << 8) | ((rd & 8) << 4) | ((rs & 8) << 3) | ((rs & 7) << 3) | (rd & 7),
  ldrPc: (rd, imm) => 0x4800 | (rd << 8) | imm,
  regOff: (lb, rd, rb, ro) => 0x5000 | (lb << 9) | (ro << 6) | (rb << 3) | rd, // lb = bits 11–9
  immOff: (b, l, rd, rb, imm) => 0x6000 | (b << 12) | (l << 11) | (imm << 6) | (rb << 3) | rd,
  halfImm: (l, rd, rb, imm) => 0x8000 | (l << 11) | (imm << 6) | (rb << 3) | rd,
  spRel: (l, rd, imm) => 0x9000 | (l << 11) | (rd << 8) | imm,
  addr: (sp, rd, imm) => 0xa000 | (sp << 11) | (rd << 8) | imm,
  addSp: (neg, imm7) => 0xb000 | (neg << 7) | imm7,
  push: (list, lr = 0) => 0xb400 | (lr << 8) | list,
  pop: (list, pc = 0) => 0xbc00 | (pc << 8) | list,
  stmia: (rb, list) => 0xc000 | (rb << 8) | list,
  ldmia: (rb, list) => 0xc800 | (rb << 8) | list,
  bcond: (cond, off) => 0xd000 | (cond << 8) | (off & 0xff),
  swi: (n) => 0xdf00 | n,
  b: (off) => 0xe000 | (off & 0x7ff),
  bl: (off) => [0xf000 | ((off >> 11) & 0x7ff), 0xf800 | (off & 0x7ff)],
};
