import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arm, thumb, OP } from './asm.js';
import { runArm, runThumb, CODE, DATA } from './harness.js';
import { mul64, shift } from '../src/cpu/arm.js';
import { MODE } from '../src/cpu/arm7tdmi.js';

const flags = (c) => `${c.n}${c.z}${c.c}${c.v}`;

// ------------------------------------------------------------------ procesamiento de datos ARM
test('ARM ADDS: acarreo y desbordamiento', () => {
  let m = runArm([arm.dpReg(OP.ADD, 1, 2, 0, 1)], ({ cpu }) => { cpu.r[0] = 0xffffffff; cpu.r[1] = 1; });
  assert.equal(m.cpu.r[2], 0); assert.equal(flags(m.cpu), '0110');
  m = runArm([arm.dpReg(OP.ADD, 1, 2, 0, 1)], ({ cpu }) => { cpu.r[0] = 0x7fffffff; cpu.r[1] = 1; });
  assert.equal(m.cpu.r[2], 0x80000000); assert.equal(flags(m.cpu), '1001');
});

test('ARM SUBS/CMP/RSBS: C = sin préstamo', () => {
  let m = runArm([arm.dpReg(OP.SUB, 1, 2, 0, 1)], ({ cpu }) => { cpu.r[0] = 5; cpu.r[1] = 7; });
  assert.equal(m.cpu.r[2], 0xfffffffe); assert.equal(flags(m.cpu), '1000');
  m = runArm([arm.dpReg(OP.CMP, 1, 0, 0, 1)], ({ cpu }) => { cpu.r[0] = 7; cpu.r[1] = 7; });
  assert.equal(flags(m.cpu), '0110');
  m = runArm([arm.dpReg(OP.SUB, 1, 2, 0, 1)], ({ cpu }) => { cpu.r[0] = 0x80000000; cpu.r[1] = 1; });
  assert.equal(m.cpu.r[2], 0x7fffffff); assert.equal(flags(m.cpu), '0011');
  m = runArm([arm.dpImm(OP.RSB, 1, 1, 0, 0)], ({ cpu }) => { cpu.r[0] = 1; }); // NEG
  assert.equal(m.cpu.r[1], 0xffffffff); assert.equal(flags(m.cpu), '1000');
});

test('ARM ADC/SBC/RSC usan el acarreo previo', () => {
  const m = runArm([
    arm.dpReg(OP.CMP, 1, 0, 0, 0),          // C = 1
    arm.dpReg(OP.ADC, 0, 2, 0, 1),          // 5 + 3 + 1
    arm.dpReg(OP.SBC, 0, 3, 0, 1),          // 5 − 3 − 0
    arm.dpImm(OP.MOV, 1, 4, 0, 0),          // C sin cambiar (rot 0), Z = 1
    arm.dpReg(OP.RSC, 0, 5, 1, 0),          // 5 − 3 − (1−C)
  ], ({ cpu }) => { cpu.r[0] = 5; cpu.r[1] = 3; });
  assert.equal(m.cpu.r[2], 9); assert.equal(m.cpu.r[3], 2); assert.equal(m.cpu.r[5], 2);
  const m2 = runArm([arm.dpReg(OP.CMP, 1, 0, 0, 1), arm.dpReg(OP.SBC, 1, 2, 0, 1)], ({ cpu }) => { cpu.r[0] = 3; cpu.r[1] = 5; }); // C = 0 → 3−5−1
  assert.equal(m2.cpu.r[2], 0xfffffffd); assert.equal(m2.cpu.c, 0);
});

test('ARM: operando inmediato rotado y su acarreo', () => {
  const m = runArm([arm.dpImm(OP.MOV, 1, 0, 0, 0xff, 4)]); // 0xFF ror 8 = 0xFF000000
  assert.equal(m.cpu.r[0], 0xff000000); assert.equal(m.cpu.c, 1); assert.equal(m.cpu.n, 1);
});

test('desplazador: casos límite (#0 y por registro ≥ 32)', () => {
  const c = { c: 1, sc: 0 };
  assert.equal(shift(c, 1, 0x80000000, 0, false), 0); assert.equal(c.sc, 1);          // LSR #32
  assert.equal(shift(c, 2, 0x80000000, 0, false), 0xffffffff); assert.equal(c.sc, 1); // ASR #32
  assert.equal(shift(c, 3, 0x2, 0, false), 0x80000001); assert.equal(c.sc, 0);        // RRX con C=1
  assert.equal(shift(c, 0, 0x1, 32, true), 0); assert.equal(c.sc, 1);                 // LSL 32
  assert.equal(shift(c, 0, 0x1, 33, true), 0); assert.equal(c.sc, 0);                 // LSL 33
  assert.equal(shift(c, 1, 0x80000000, 32, true), 0); assert.equal(c.sc, 1);          // LSR 32
  assert.equal(shift(c, 3, 0x80000001, 32, true), 0x80000001); assert.equal(c.sc, 1); // ROR 32
  c.c = 0; assert.equal(shift(c, 0, 0x1234, 0, true), 0x1234); assert.equal(c.sc, 0);  // por registro 0: sin cambio
});

test('ARM: desplazamiento por registro lee PC como dirección + 12', () => {
  const m = runArm([arm.dpRegReg(OP.MOV, 0, 0, 0, 15, 0, 1)], ({ cpu }) => { cpu.r[1] = 0; });
  assert.equal(m.cpu.r[0], CODE + 12);
});

test('ARM MOVS PC, LR restaura CPSR desde SPSR', () => {
  const m = runArm([arm.dpReg(OP.MOV, 1, 15, 0, 14)], ({ cpu }) => {
    cpu.switchMode(MODE.IRQ); cpu.spsr = 0x6000003f; cpu.r[14] = 0x03000101; // destino Thumb
  });
  assert.equal(m.cpu.mode, MODE.SYS); assert.equal(m.cpu.t, 1); assert.equal(m.cpu.z, 1); assert.equal(m.cpu.next, 0x03000100);
});

// ------------------------------------------------------------------ multiplicaciones
test('MUL/MLA y multiplicaciones largas con y sin signo', () => {
  assert.deepEqual(mul64(0xffffffff, 0xffffffff, false), [1, 0xfffffffe]);
  assert.deepEqual(mul64(0xffffffff, 0xffffffff, true), [1, 0]);           // (−1)·(−1)
  assert.deepEqual(mul64(0x80000000, 2, true), [0, 0xffffffff]);           // −2^31 · 2
  const big = 123456789n * 987654321n; // referencia independiente con BigInt
  assert.deepEqual(mul64(123456789, 987654321, false), [Number(big & 0xffffffffn), Number(big >> 32n)]);
  const sbig = BigInt.asUintN(64, -123456789n * 987654321n);
  assert.deepEqual(mul64((-123456789) >>> 0, 987654321, true), [Number(sbig & 0xffffffffn), Number(sbig >> 32n)]);
  const m = runArm([
    arm.mul(2, 0, 1, { s: 1 }),
    arm.mul(3, 0, 1, { a: 1, rn: 4 }),
    arm.mull(6, 5, 0, 1),               // UMULL
    arm.mull(8, 7, 0, 1, { a: 1 }),     // UMLAL
  ], ({ cpu }) => { cpu.r[0] = 0xfffffffe; cpu.r[1] = 3; cpu.r[4] = 10; cpu.r[7] = 0xffffffff; cpu.r[8] = 0; });
  assert.equal(m.cpu.r[2], 0xfffffffa); assert.equal(m.cpu.n, 1);
  assert.equal(m.cpu.r[3], 4);
  assert.equal(m.cpu.r[5], 0xfffffffa); assert.equal(m.cpu.r[6], 2);         // −2·3 = −6 sin signo
  assert.equal(m.cpu.r[7], 0xfffffff9); assert.equal(m.cpu.r[8], 3);         // acumulado con acarreo
});

// ------------------------------------------------------------------ memoria
test('LDR desalineado rota; LDRH desalineado rota 8; LDRSH desalineado = LDRSB', () => {
  const m = runArm([
    arm.ldrImm(1, 0, 1, 0, 1),     // LDR r1, [r0, #1]
    arm.half(1, 1, 2, 0, 1),       // LDRH r2, [r0, #1]
    arm.half(1, 3, 3, 0, 1),       // LDRSH r3, [r0, #1]
    arm.half(1, 2, 4, 0, 3),       // LDRSB r4, [r0, #3]
    arm.ldrImm(1, 1, 5, 0, 2),     // LDRB r5, [r0, #2]
  ], ({ cpu, bus }) => { cpu.r[0] = DATA; bus.write32(DATA, 0x8899aabb); });
  assert.equal(m.cpu.r[1], 0xbb8899aa);
  assert.equal(m.cpu.r[2], 0xbb0000aa);
  assert.equal(m.cpu.r[3], 0xffffffaa);
  assert.equal(m.cpu.r[4], 0xffffff88);
  assert.equal(m.cpu.r[5], 0x99);
});

test('LDR/STR: preindexado con escritura y postindexado', () => {
  const m = runArm([
    arm.ldrImm(0, 0, 1, 0, 8, { w: 1 }),   // STR r1, [r0, #8]!
    arm.ldrImm(0, 0, 2, 0, 4, { p: 0 }),   // STR r2, [r0], #4
    arm.ldrImm(1, 0, 3, 0, 4, { p: 1, u: 0 }), // LDR r3, [r0, #-4]
  ], ({ cpu }) => { cpu.r[0] = DATA; cpu.r[1] = 0x11; cpu.r[2] = 0x22; });
  assert.equal(m.bus.read32(DATA + 8), 0x22); // el segundo STR escribe sobre DATA+8 (r0 ya actualizado)
  assert.equal(m.cpu.r[0], DATA + 12);
  assert.equal(m.cpu.r[3], 0x22);
});

test('STR de PC guarda dirección + 12', () => {
  const m = runArm([arm.ldrImm(0, 0, 15, 0, 0)], ({ cpu }) => { cpu.r[0] = DATA; });
  assert.equal(m.bus.read32(DATA), CODE + 12);
});

test('LDM/STM: modos IA/IB/DA/DB, escritura y base en la lista', () => {
  let m = runArm([arm.block(0, 13, 0b1110, { p: 1, u: 0, w: 1 })], ({ cpu }) => { cpu.r[13] = DATA + 0x100; cpu.r[1] = 1; cpu.r[2] = 2; cpu.r[3] = 3; }); // STMDB sp!
  assert.equal(m.cpu.r[13], DATA + 0x100 - 12);
  assert.deepEqual([0, 4, 8].map((o) => m.bus.read32(DATA + 0xf4 + o)), [1, 2, 3]);
  m = runArm([arm.block(1, 0, 0b0110, { p: 1, u: 1, w: 1 })], ({ cpu, bus }) => { cpu.r[0] = DATA; bus.write32(DATA + 4, 0xa); bus.write32(DATA + 8, 0xb); }); // LDMIB
  assert.equal(m.cpu.r[1], 0xa); assert.equal(m.cpu.r[2], 0xb); assert.equal(m.cpu.r[0], DATA + 8);
  m = runArm([arm.block(1, 0, 0b0011, { p: 0, u: 0, w: 1 })], ({ cpu, bus }) => { cpu.r[0] = DATA + 8; bus.write32(DATA + 4, 0xc); bus.write32(DATA + 8, 0xd); }); // LDMDA
  assert.equal(m.cpu.r[0], 0xc); assert.equal(m.cpu.r[1], 0xd); // base en la lista: gana el valor cargado
  m = runArm([arm.block(0, 1, 0b0110, { w: 1 })], ({ cpu }) => { cpu.r[1] = DATA; cpu.r[2] = 0x22; }); // STMIA r1!, {r1,r2}: base primera → valor original
  assert.equal(m.bus.read32(DATA), DATA);
  m = runArm([arm.block(0, 2, 0b0110, { w: 1 })], ({ cpu }) => { cpu.r[2] = DATA; cpu.r[1] = 0x11; }); // base no primera → valor nuevo
  assert.equal(m.bus.read32(DATA + 4), DATA + 8);
});

test('LDM con PC y bit S restaura CPSR; STM ^ guarda registros de usuario', () => {
  const m = runArm([arm.block(1, 0, 0x8000, { s: 1, w: 0 })], ({ cpu, bus }) => {
    cpu.switchMode(MODE.IRQ); cpu.spsr = 0x0000001f; cpu.r[0] = DATA; bus.write32(DATA, 0x03000040);
  });
  assert.equal(m.cpu.mode, MODE.SYS); assert.equal(m.cpu.next, 0x03000040);
  const m2 = runArm([arm.block(0, 0, 0x6000, { s: 1, w: 0 })], ({ cpu }) => {
    cpu.r[13] = 0xaaaa; cpu.switchMode(MODE.IRQ); cpu.r[13] = 0xbbbb; cpu.r[0] = DATA;
  });
  assert.equal(m2.bus.read32(DATA), 0xaaaa);
});

test('SWP intercambia memoria y registro', () => {
  const m = runArm([arm.swp(1, 2, 0)], ({ cpu, bus }) => { cpu.r[0] = DATA; cpu.r[2] = 0x5555; bus.write32(DATA, 0x7777); });
  assert.equal(m.cpu.r[1], 0x7777); assert.equal(m.bus.read32(DATA), 0x5555);
});

// ------------------------------------------------------------------ saltos y estado
test('B/BL/BX y condiciones', () => {
  let m = runArm([arm.b(1, 1)], () => {}, 1); // BL a CODE + 8 + 4
  assert.equal(m.cpu.next, CODE + 12); assert.equal(m.cpu.r[14], CODE + 4);
  m = runArm([arm.b(-2 & 0xffffff)], () => {}, 1);
  assert.equal(m.cpu.next, CODE); // b . (−2 palabras desde PC+8)
  m = runArm([arm.dpReg(OP.CMP, 1, 0, 0, 0), arm.b(5, 0, 1)], () => {}, 2); // BNE no se toma
  assert.equal(m.cpu.next, CODE + 8);
  m = runArm([arm.bx(0)], ({ cpu }) => { cpu.r[0] = CODE + 0x21; }, 1);
  assert.equal(m.cpu.t, 1); assert.equal(m.cpu.next, CODE + 0x20);
});

test('MRS/MSR: cambio de modo con bancos de r13/r14 y protección en modo usuario', () => {
  const m = runArm([arm.mrs(0), arm.msrReg(1, 0b0001), arm.dpImm(OP.MOV, 0, 13, 0, 0x42)], ({ cpu }) => { cpu.r[13] = 0x1111; cpu.r[1] = 0x12; });
  assert.equal(m.cpu.r[0], 0x1f); assert.equal(m.cpu.mode, MODE.IRQ); assert.equal(m.cpu.r[13], 0x42);
  m.cpu.switchMode(MODE.SYS); assert.equal(m.cpu.r[13], 0x1111);
  const u = runArm([arm.msrReg(1, 0b1001)], ({ cpu }) => { cpu.switchMode(MODE.USR); cpu.r[1] = 0xf000001f; });
  assert.equal(u.cpu.mode, MODE.USR); assert.equal(u.cpu.n, 1); // solo banderas
});

test('IRQ: entrada a 0x18 con LR = siguiente + 4 y retorno', () => {
  const m = runArm([arm.dpImm(OP.MOV, 0, 0, 0, 1), arm.dpImm(OP.MOV, 0, 1, 0, 2)], ({ cpu }) => { cpu.irq.ime = 1; cpu.irq.ie = 1; cpu.irq.if = 1; }, 1);
  assert.equal(m.cpu.mode, MODE.IRQ); assert.equal(m.cpu.r[14], CODE + 4); assert.equal(m.cpu.i, 1);
  assert.equal(m.cpu.spsr & 0x1f, MODE.SYS);
});

// ------------------------------------------------------------------ Thumb
test('Thumb formatos 1–3: desplazamientos, ADD/SUB, inmediatos', () => {
  const m = runThumb([
    thumb.imm8(0, 0, 0x81),        // MOV r0, #0x81
    thumb.shift(0, 1, 0, 25),      // LSL r1, r0, #25 → 0x02000000, C = bit 7 de 0x81 desplazado
    thumb.shift(1, 2, 0, 0),       // LSR r2, r0, #32 → 0, C = bit 31 de r0 (0)
    thumb.addSub(1, 1, 3, 0, 1),   // SUB r3, r0, #1
    thumb.imm8(1, 3, 0x80),        // CMP r3, #0x80 → Z
  ]);
  assert.equal(m.cpu.r[1], 0x02000000); assert.equal(m.cpu.r[2], 0); assert.equal(m.cpu.r[3], 0x80); assert.equal(m.cpu.z, 1); assert.equal(m.cpu.c, 1);
});

test('Thumb ALU: NEG, MUL, ROR, ADC, BIC, MVN, TST, CMN', () => {
  const m = runThumb([
    thumb.alu(0x9, 1, 0),   // NEG r1, r0
    thumb.alu(0xd, 2, 0),   // MUL r2, r0  (r2 = r2 * r0)
    thumb.alu(0x7, 3, 4),   // ROR r3, r4
    thumb.alu(0xe, 5, 0),   // BIC r5, r0
    thumb.alu(0xf, 6, 0),   // MVN r6, r0
    thumb.alu(0xb, 0, 1),   // CMN r0, r1 → 0, Z = 1, C = 1
  ], ({ cpu }) => { cpu.r[0] = 3; cpu.r[2] = 7; cpu.r[3] = 0x10; cpu.r[4] = 4; cpu.r[5] = 0xff; });
  assert.equal(m.cpu.r[1], 0xfffffffd); assert.equal(m.cpu.r[2], 21); assert.equal(m.cpu.r[3], 0x1); assert.equal(m.cpu.r[5], 0xfc); assert.equal(m.cpu.r[6], 0xfffffffc);
  assert.equal(m.cpu.z, 1); assert.equal(m.cpu.c, 1);
});

test('Thumb registros altos: ADD/MOV a PC y BX a ARM', () => {
  let m = runThumb([thumb.hi(2, 8, 0), thumb.hi(0, 8, 8), thumb.hi(1, 8, 0)], ({ cpu }) => { cpu.r[0] = 5; }); // MOV r8,r0; ADD r8,r8; CMP r8,r0
  assert.equal(m.cpu.r[8], 10); assert.equal(m.cpu.z, 0); assert.equal(m.cpu.c, 1);
  m = runThumb([thumb.hi(3, 0, 15)], () => {}, 1); // BX PC → ARM en CODE+4
  assert.equal(m.cpu.t, 0); assert.equal(m.cpu.next, CODE + 4);
  m = runThumb([thumb.hi(2, 15, 0)], ({ cpu }) => { cpu.r[0] = CODE + 0x41; }, 1); // MOV PC, r0
  assert.equal(m.cpu.t, 1); assert.equal(m.cpu.next, CODE + 0x40);
});

test('Thumb cargas: PC relativo, registro, inmediato, halfword, SP', () => {
  const m = runThumb([
    thumb.ldrPc(0, 3),                 // LDR r0, [PC, #12] → (CODE+4 & ~2) + 12 = CODE+16 (tras el programa)
    thumb.regOff(0b100, 1, 6, 7),      // LDR r1, [r6, r7]
    thumb.regOff(0b011, 2, 6, 7),      // LDSB r2, [r6, r7]
    thumb.regOff(0b111, 3, 6, 5),      // LDSH r3, [r6, r5]
    thumb.regOff(0b101, 4, 6, 5),      // LDRH r4, [r6, r5]
    thumb.immOff(1, 1, 5, 6, 3),       // LDRB r5, [r6, #3]
  ], ({ cpu, bus }) => {
    bus.write32(CODE + 16, 0xcafebabe);
    cpu.r[6] = DATA; cpu.r[7] = 0; cpu.r[5] = 2; bus.write32(DATA, 0x8001f0f0);
  });
  assert.equal(m.cpu.r[0], 0xcafebabe); assert.equal(m.cpu.r[1], 0x8001f0f0); assert.equal(m.cpu.r[2], 0xfffffff0);
  assert.equal(m.cpu.r[3], 0xffff8001); assert.equal(m.cpu.r[4], 0x8001); assert.equal(m.cpu.r[5], 0x80);
});

test('Thumb almacenamiento: STR/STRB/STRH con registro e inmediato, SP relativo', () => {
  const m = runThumb([
    thumb.regOff(0b000, 0, 6, 7), thumb.regOff(0b010, 1, 6, 4), thumb.regOff(0b001, 2, 6, 5),
    thumb.halfImm(0, 2, 6, 4), thumb.spRel(0, 0, 1), thumb.spRel(1, 3, 1),
  ], ({ cpu }) => { cpu.r[6] = DATA; cpu.r[7] = 0; cpu.r[4] = 4; cpu.r[5] = 6; cpu.r[0] = 0x11223344; cpu.r[1] = 0x1ff; cpu.r[2] = 0xabcd; cpu.r[13] = DATA + 0x40; });
  assert.equal(m.bus.read32(DATA), 0x11223344); assert.equal(m.bus.read8(DATA + 4), 0xff); assert.equal(m.bus.read16(DATA + 6), 0xabcd);
  assert.equal(m.bus.read16(DATA + 8), 0xabcd); assert.equal(m.bus.read32(DATA + 0x44), 0x11223344); assert.equal(m.cpu.r[3], 0x11223344);
});

test('Thumb PUSH/POP con LR/PC, STMIA/LDMIA y ADD SP', () => {
  const m = runThumb([
    thumb.push(0b0110, 1),           // PUSH {r1, r2, lr}
    thumb.addSp(1, 1),               // SUB SP, #4
    thumb.addSp(0, 1),               // ADD SP, #4
    thumb.pop(0b1000, 1),            // POP {r3, pc} → r3 = r1, PC = r2
  ], ({ cpu }) => { cpu.r[13] = DATA + 0x100; cpu.r[1] = 0x77; cpu.r[2] = CODE + 0x81; cpu.r[14] = 0x99; });
  assert.equal(m.cpu.r[3], 0x77); assert.equal(m.cpu.next, CODE + 0x80); assert.equal(m.cpu.r[13], DATA + 0x100 - 4);
  const s = runThumb([thumb.stmia(0, 0b0110), thumb.ldmia(3, 0b0011)], ({ cpu }) => { cpu.r[0] = DATA; cpu.r[1] = 5; cpu.r[2] = 6; cpu.r[3] = DATA; });
  assert.equal(s.cpu.r[0], 5); assert.equal(s.cpu.r[1], 6); assert.equal(s.cpu.r[3], DATA + 8); // base r3 fuera de la lista: escritura
});

test('Thumb saltos: condicional, incondicional y BL largo', () => {
  let m = runThumb([thumb.imm8(1, 0, 0), thumb.bcond(0, 4)], () => {}, 2); // CMP r0,#0; BEQ +8
  assert.equal(m.cpu.next, CODE + 2 + 4 + 8);
  m = runThumb([thumb.b(-2 & 0x7ff)], () => {}, 1); // b . (PC+4 − 4)
  assert.equal(m.cpu.next, CODE);
  m = runThumb([thumb.bl(0x100)], () => {}, 2); // BL CODE + 4 + 0x200
  assert.equal(m.cpu.next, CODE + 4 + 0x200); assert.equal(m.cpu.r[14], (CODE + 4) | 1);
  m = runThumb([thumb.bl(-4 & 0x3fffff)], () => {}, 2); // BL hacia atrás
  assert.equal(m.cpu.next, CODE + 4 - 8);
});

test('Thumb ADD con PC alinea a 4 (formato 12)', () => {
  const m = runThumb([0, thumb.addr(0, 0, 1)], () => {}, 2); // en CODE+2: PC = CODE+6 → &~2 = CODE+4, + 4
  assert.equal(m.cpu.r[0], CODE + 8);
});

test('SMULL con operandos negativos', () => {
  const m = runArm([arm.mull(3, 2, 0, 1, { signed: 1, s: 1 })], ({ cpu }) => { cpu.r[0] = 0xfffffffe; cpu.r[1] = 3; });
  assert.equal(m.cpu.r[2], 0xfffffffa); assert.equal(m.cpu.r[3], 0xffffffff); assert.equal(m.cpu.n, 1);
});
