/**
 * Panel de desarrollador: registros de la CPU, E/S de vídeo, DMA, timers, interrupciones, llamadas a
 * la BIOS, memoria, registro de instrucciones y capas de vídeo. Solo lee el estado (salvo las capas).
 */
const h = (v, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const MODES = { 0x10: 'USR', 0x11: 'FIQ', 0x12: 'IRQ', 0x13: 'SVC', 0x17: 'ABT', 0x1b: 'UND', 0x1f: 'SYS' };

export class Debugger {
  constructor(gba, el, logger) {
    this.gba = gba; this.el = el; this.logger = logger;
    this.memAddr = 0x02000000; this.traceOn = false; this.trace = []; this.fps = 0;
  }
  setTrace(on) {
    this.traceOn = on;
    this.gba.cpu.trace = on ? (pc, op, t) => { this.trace.push([pc, op, t]); if (this.trace.length > 64) this.trace.shift(); } : null;
  }
  render() {
    const { cpu, io, irq, dma, timers, ppu, bios } = this.gba;
    const r = io.regs;
    const regs = Array.from({ length: 16 }, (_, k) => `r${k.toString().padEnd(2)} ${h(k === 15 ? cpu.next : cpu.r[k])}`);
    const flags = `${cpu.n ? 'N' : '-'}${cpu.z ? 'Z' : '-'}${cpu.c ? 'C' : '-'}${cpu.v ? 'V' : '-'} ${cpu.i ? 'I' : '-'}${cpu.f ? 'F' : '-'}${cpu.t ? 'T' : '-'}`;
    const mem = [];
    for (let row = 0; row < 8; row++) {
      const a = (this.memAddr + row * 16) >>> 0;
      const bytes = []; for (let k = 0; k < 16; k++) bytes.push(h(this.gba.bus.read8(a + k), 2));
      mem.push(`${h(a)}  ${bytes.join(' ')}`);
    }
    this.el.querySelector('[data-dbg=cpu]').textContent =
      `${regs.slice(0, 8).map((x, i) => `${x}   ${regs[i + 8]}`).join('\n')}\nCPSR ${h(cpu.cpsr)} ${flags} ${MODES[cpu.mode] ?? '?'}  ${cpu.t ? 'Thumb' : 'ARM'}\nciclos ${cpu.cycles}  HALT ${irq.halted ? 'sí' : 'no'}  FPS ${this.fps.toFixed(1)}`;
    this.el.querySelector('[data-dbg=video]').textContent =
      `DISPCNT ${h(r[0], 4)}  modo ${r[0] & 7}  DISPSTAT ${h(ppu.dispstat, 4)}  VCOUNT ${ppu.vcount}\n` +
      [0, 1, 2, 3].map((b) => `BG${b}CNT ${h(r[4 + b], 4)}  HOFS ${r[8 + b * 2] & 0x1ff} VOFS ${r[9 + b * 2] & 0x1ff}`).join('\n') +
      `\nWININ ${h(r[0x24], 4)} WINOUT ${h(r[0x25], 4)}  BLDCNT ${h(r[0x28], 4)} BLDALPHA ${h(r[0x29], 4)} BLDY ${r[0x2a] & 31}`;
    this.el.querySelector('[data-dbg=hw]').textContent =
      `IE ${h(irq.ie, 4)}  IF ${h(irq.if, 4)}  IME ${irq.ime}\nIRQ recibidas: ${['VBl', 'HBl', 'VCt', 'T0', 'T1', 'T2', 'T3', 'SIO', 'D0', 'D1', 'D2', 'D3', 'Key', 'Pak'].map((n, i) => `${n}:${irq.counts[i]}`).join(' ')}\n` +
      dma.ch.map((c, i) => `DMA${i} ${c.active ? 'activa' : '------'} ctl ${h(c.control, 4)} ${h(c.src)}→${h(c.dst)} n=${c.count}`).join('\n') + '\n' +
      timers.t.map((t, i) => `TM${i} ${t.enabled ? 'on ' : 'off'} cnt ${h(t.counter, 4)} rel ${h(t.reload, 4)} ctl ${h(t.control, 2)}${t.cascade ? ' cascada' : ''}`).join('\n') +
      `\nSWI: ${[...bios.calls].map((n, i) => (n ? `${h(i, 2)}×${n}` : null)).filter(Boolean).join(' ')}`;
    this.el.querySelector('[data-dbg=mem]').textContent = mem.join('\n');
    this.el.querySelector('[data-dbg=trace]').textContent = this.traceOn
      ? this.trace.slice().reverse().map(([pc, op, t]) => `${h(pc)}  ${t ? h(op, 4).padStart(8) : h(op)}  ${t ? 'T' : 'A'}`).join('\n')
      : 'Registro de instrucciones desactivado (reduce la velocidad al activarlo).';
    this.el.querySelector('[data-dbg=log]').textContent = this.logger.entries.slice(-40).reverse().map((e) => `${e.time} [${e.level}] ${e.message}`).join('\n') || 'Sin incidencias.';
  }
}
