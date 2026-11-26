/** Máquina mínima para pruebas: bus real + E/S simulada; programas en IWRAM (0x03000000). */
import { Bus } from '../src/memory/bus.js';
import { ARM7TDMI } from '../src/cpu/arm7tdmi.js';
import { Interrupts } from '../src/hardware/interrupts.js';

export const CODE = 0x03000000, DATA = 0x02000000;

export function machine() {
  const bus = new Bus();
  const regs = new Uint16Array(0x200);
  bus.io = { regs, dispcnt: 0, read8: (a) => regs[(a & 0x3fe) >> 1] >> ((a & 1) * 8) & 0xff, read16: (a) => regs[(a & 0x3fe) >> 1], write8() {}, write16: (a, v) => { regs[(a & 0x3fe) >> 1] = v; }, write32: (a, v) => { regs[(a & 0x3fe) >> 1] = v & 0xffff; regs[((a & 0x3fe) >> 1) + 1] = v >>> 16; } };
  const cpu = new ARM7TDMI(bus);
  cpu.irq = new Interrupts();
  cpu.resetToRom(CODE);
  return { bus, cpu };
}
/** Carga palabras ARM y ejecuta `steps` instrucciones (por defecto, todas). */
export function runArm(words, setup = () => {}, steps = words.length) {
  const m = machine();
  words.forEach((w, i) => m.bus.write32(CODE + i * 4, w));
  setup(m);
  for (let i = 0; i < steps; i++) m.cpu.step();
  return m;
}
export function runThumb(halfs, setup = () => {}, steps = halfs.length) {
  const m = machine();
  halfs.flat().forEach((h, i) => m.bus.write16(CODE + i * 2, h));
  m.cpu.t = 1; m.cpu.branch(CODE);
  setup(m);
  for (let i = 0; i < steps; i++) m.cpu.step();
  return m;
}
