/**
 * Emulador GBA: crea y conecta los módulos y ejecuta fotogramas.
 * Un fotograma = 228 líneas × 1232 ciclos = 280 896 ciclos (≈ 59,73 Hz a 16,78 MHz).
 * Dentro de cada tramo se ejecuta la CPU en porciones que terminan en el siguiente desbordamiento
 * de timer, para que las interrupciones de timer y el FIFO de audio ocurran con precisión de ciclo.
 */
import { Bus } from './memory/bus.js';
import { IO } from './memory/io.js';
import { ARM7TDMI } from './cpu/arm7tdmi.js';
import { Interrupts } from './hardware/interrupts.js';
import { Timers } from './hardware/timers.js';
import { DMA, DMA_TIMING } from './hardware/dma.js';
import { Keypad } from './hardware/keypad.js';
import { Serial } from './hardware/serial.js';
import { PPU } from './video/ppu.js';
import { APU } from './audio/apu.js';
import { SoundSynth } from './audio/sound.js';
import { BiosHLE, buildBiosImage, findM4aTemplate } from './bios/hle.js';
import { inspectRom } from './cartridge/romLoader.js';
import { createSaveMemory } from './cartridge/saveMemory.js';
import { GPIO, RTC } from './cartridge/gpio.js';

export const CYCLES_PER_LINE = 1232, HDRAW_CYCLES = 960, LINES = 228;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES;
export const CPU_HZ = 16777216;

export class GBA {
  constructor({ log } = {}) {
    this.log = log ?? (() => {});
    this.bus = new Bus();
    this.irq = new Interrupts();
    this.io = new IO(this);
    this.bus.io = this.io;
    this.cpu = new ARM7TDMI(this.bus);
    this.cpu.irq = this.irq;
    this.timers = new Timers(this.irq);
    this.dma = new DMA(this.bus, this.irq);
    this.keypad = new Keypad(this.irq);
    this.serial = new Serial(this.irq, this.io);
    this.ppu = new PPU(this.bus, this.io, this.irq);
    this.apu = new APU(this);
    this.synth = new SoundSynth(this.apu);
    this.apu.sink = this.synth;
    this.timers.onOverflow = (t) => { if (t < 2) this.apu.timerOverflow(t); };
    this.bios = new BiosHLE(this);
    this.cpu.swiHandler = (n) => this.bios.swi(n);
    this.cpu.undefinedHandler = (op, pc, thumb) => this.log('error', `Instrucción no definida ${thumb ? 'Thumb' : 'ARM'} 0x${op.toString(16)} en 0x${pc.toString(16)}`);
    this.bus.bios.set(buildBiosImage());
    this.info = null;
    this.frameCount = 0;
    this.onFrame = null;
  }

  now() { return this.cpu.cycles; }

  /** Carga una ROM (Uint8Array) y deja el sistema listo en el punto de entrada del cartucho. */
  loadRom(bytes, fileName = '') {
    const info = inspectRom(bytes, fileName);
    this.info = info;
    this.bus.loadRom(bytes);
    this.bus.save = createSaveMemory(info.saveType);
    if (info.rtc) { this.rtc = new RTC(); this.bus.gpio = new GPIO(this.rtc); } else { this.rtc = null; this.bus.gpio = null; }
    this.bios.m4aTemplate = findM4aTemplate(bytes, Math.min(bytes.length, 0x1000000));
    this.reset();
    return info;
  }

  reset() {
    const b = this.bus;
    b.ewram.fill(0); b.iwram.fill(0); b.pal.fill(0); b.vram.fill(0); b.oam.fill(0);
    this.io.regs.fill(0);
    this.irq.ie = this.irq.if = this.irq.ime = 0; this.irq.halted = false;
    this.ppu.dispstat = 0; this.ppu.vcount = 0;
    b.setWaitcnt(0);
    this.cpu.cycles = 0; this.timers.lastCycle = 0;
    this.cpu.inIntrWait = false;
    this.io.write16(0x04000088, 0x200); // SOUNDBIAS tras el arranque de la BIOS
    this.cpu.resetToRom(0x08000000);
    this.frameCount = 0;
  }

  /** Ejecuta la CPU durante `cycles` ciclos, cortando en cada desbordamiento de timer. */
  #runCpu(cycles) {
    const cpu = this.cpu, timers = this.timers, dma = this.dma;
    const end = cpu.cycles + cycles;
    let last = cpu.cycles;
    while (cpu.cycles < end) {
      const toTimer = timers.cyclesUntilOverflow();
      const toSerial = this.serial.pending ? Math.max(1, this.serial.pending - cpu.cycles) : Infinity;
      const slice = Math.max(1, Math.min(end - cpu.cycles, toTimer, toSerial));
      cpu.run(slice);
      if (dma.cyclesUsed) { cpu.cycles += dma.cyclesUsed; dma.cyclesUsed = 0; }
      timers.sync(cpu.cycles);
      if (this.serial.pending) this.serial.update(cpu.cycles);
      this.synth.advance(cpu.cycles - last); last = cpu.cycles;
    }
  }

  /** Ejecuta un fotograma completo (desde la línea 0 hasta el final del VBlank). */
  runFrame() {
    const ppu = this.ppu, dma = this.dma;
    for (let y = 0; y < LINES; y++) {
      if (ppu.startLine(y)) dma.trigger(DMA_TIMING.VBLANK);
      this.#runCpu(HDRAW_CYCLES);
      if (y < 160) ppu.renderLine(y);
      ppu.startHblank();
      if (y < 160) dma.trigger(DMA_TIMING.HBLANK);
      this.#runCpu(CYCLES_PER_LINE - HDRAW_CYCLES);
      ppu.endHblank();
    }
    this.frameCount++;
    this.onFrame?.(ppu.framebuffer);
  }
}
