/**
 * Estados rápidos: instantánea completa del hardware emulado (CPU, memorias, E/S, timers, DMA,
 * PPU, APU, memoria de guardado, RTC y puerto serie). Los arrays se copian para que el estado no
 * cambie al seguir ejecutando. Es independiente del guardado normal del juego.
 */
export const STATE_VERSION = 1;
const copyObj = (o) => JSON.parse(JSON.stringify(o));

export function captureState(gba) {
  const { cpu, bus, io, irq, timers, dma, ppu, apu, synth, keypad, serial } = gba;
  return {
    version: STATE_VERSION, game: gba.info?.gameCode,
    cpu: { r: cpu.r.slice(), bankR13: cpu.bankR13.slice(), bankR14: cpu.bankR14.slice(), bankSpsr: cpu.bankSpsr.slice(), fiqR: cpu.fiqR.slice(), usrR: cpu.usrR.slice(),
      flags: [cpu.n, cpu.z, cpu.c, cpu.v, cpu.i, cpu.f, cpu.t, cpu.mode], next: cpu.next, cycles: cpu.cycles, inIntrWait: !!cpu.inIntrWait },
    mem: { ewram: bus.ewram.slice(), iwram: bus.iwram.slice(), pal: bus.pal.slice(), vram: bus.vram.slice(), oam: bus.oam.slice(), waitcnt: bus.waitcnt, openBus: bus.openBus, biosLatch: bus.biosLatch },
    io: { regs: io.regs.slice(), postflg: io.postflg },
    irq: { ie: irq.ie, if: irq.if, ime: irq.ime, halted: irq.halted, stopped: irq.stopped },
    timers: { t: copyObj(timers.t), lastCycle: timers.lastCycle },
    dma: copyObj(dma.ch),
    keypad: { keycnt: keypad.keycnt },
    ppu: { dispstat: ppu.dispstat, vcount: ppu.vcount, refX: ppu.refX.slice(), refY: ppu.refY.slice() },
    apu: { regs: apu.regs.slice(), fifo: apu.fifo.map((f) => f.slice()), fifoR: [...apu.fifoR], fifoW: [...apu.fifoW], fifoN: [...apu.fifoN], current: [...apu.current] },
    synth: { ch: copyObj(synth.ch), wave: synth.wave.slice(), direct: [...synth.direct], seqStep: synth.seqStep },
    save: bus.save ? { data: bus.save.data.slice(), bank: bus.save.bank ?? 0 } : null,
    rtc: gba.rtc ? { offsetMs: gba.rtc.offsetMs, status: gba.rtc.status } : null,
    serial: { rcnt: serial.rcnt, siocnt: serial.siocnt },
  };
}

export function restoreState(gba, s) {
  if (!s || s.version !== STATE_VERSION) throw new Error('Estado incompatible con esta versión del emulador.');
  if (gba.info && s.game !== gba.info.gameCode) throw new Error(`El estado es de otro juego (${s.game}).`);
  const { cpu, bus, io, irq, timers, dma, ppu, apu, synth, keypad, serial } = gba;
  cpu.r.set(s.cpu.r); cpu.bankR13.set(s.cpu.bankR13); cpu.bankR14.set(s.cpu.bankR14); cpu.bankSpsr.set(s.cpu.bankSpsr); cpu.fiqR.set(s.cpu.fiqR); cpu.usrR.set(s.cpu.usrR);
  [cpu.n, cpu.z, cpu.c, cpu.v, cpu.i, cpu.f, cpu.t, cpu.mode] = s.cpu.flags;
  cpu.next = s.cpu.next; cpu.cycles = s.cpu.cycles; cpu.inIntrWait = s.cpu.inIntrWait;
  for (const k of ['ewram', 'iwram', 'pal', 'vram', 'oam']) bus[k].set(s.mem[k]);
  bus.setWaitcnt(s.mem.waitcnt); bus.openBus = s.mem.openBus; bus.biosLatch = s.mem.biosLatch;
  io.regs.set(s.io.regs); io.postflg = s.io.postflg;
  Object.assign(irq, s.irq);
  s.timers.t.forEach((t, i) => Object.assign(timers.t[i], t)); timers.lastCycle = s.timers.lastCycle;
  s.dma.forEach((c, i) => Object.assign(dma.ch[i], c));
  keypad.keycnt = s.keypad.keycnt;
  ppu.dispstat = s.ppu.dispstat; ppu.vcount = s.ppu.vcount; ppu.refX.set(s.ppu.refX); ppu.refY.set(s.ppu.refY);
  apu.regs.set(s.apu.regs); s.apu.fifo.forEach((f, k) => apu.fifo[k].set(f));
  apu.fifoR = [...s.apu.fifoR]; apu.fifoW = [...s.apu.fifoW]; apu.fifoN = [...s.apu.fifoN]; apu.current = [...s.apu.current];
  s.synth.ch.forEach((c, i) => Object.assign(synth.ch[i], c)); synth.wave.set(s.synth.wave); synth.direct = [...s.synth.direct]; synth.seqStep = s.synth.seqStep;
  if (s.save && bus.save) { bus.save.data.set(s.save.data); if ('bank' in bus.save) bus.save.bank = s.save.bank; }
  if (s.rtc && gba.rtc) { gba.rtc.offsetMs = s.rtc.offsetMs; gba.rtc.status = s.rtc.status; }
  serial.rcnt = s.serial.rcnt; serial.siocnt = s.serial.siocnt; serial.pending = 0;
}
