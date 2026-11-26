/**
 * APU (GBATEK, "GBA Sound Controller").
 * Fase actual: registros y FIFO de Direct Sound A/B con su mecánica completa (timers + DMA1/2),
 * porque el juego depende de ella para avanzar. La síntesis (PSG 1–4, mezcla, Web Audio) está en
 * sound.js y se conecta mediante `sink`.
 */
export class APU {
  constructor(emu) {
    this.emu = emu;
    this.regs = new Uint16Array(0x30); // 0x060–0x0BF
    this.fifo = [new Int8Array(32), new Int8Array(32)];
    this.fifoR = [0, 0]; this.fifoW = [0, 0]; this.fifoN = [0, 0];
    this.current = [0, 0]; // muestra actual de cada canal Direct Sound
    this.sink = null;      // sintetizador (sound.js) o null
  }
  get soundcnth() { return this.regs[(0x82 - 0x60) >> 1]; }
  get soundcntx() { return this.regs[(0x84 - 0x60) >> 1]; }

  read16(off) {
    if (off === 0x84) return (this.soundcntx & 0x80) | (this.sink ? this.sink.activeMask() : 0);
    if (off >= 0xa0) return 0; // FIFO: solo escritura
    return this.regs[(off - 0x60) >> 1];
  }
  write16(off, v) {
    const i = (off - 0x60) >> 1;
    if (off === 0x82) { // SOUNDCNT_H: bits 11 y 15 reinician los FIFO
      if (v & 0x0800) this.#resetFifo(0);
      if (v & 0x8000) this.#resetFifo(1);
      v &= 0x770f;
    }
    if (off === 0x84 && !(v & 0x80)) { // apagar el sonido borra los registros PSG
      for (let k = 0; k < (0x84 - 0x60) >> 1; k++) if (k !== 1) this.regs[k] = 0;
    }
    this.regs[i] = v;
    this.sink?.write16(off, v);
  }
  #resetFifo(k) { this.fifoR[k] = this.fifoW[k] = this.fifoN[k] = 0; }
  fifoWrite8(k, v) {
    if (this.fifoN[k] >= 32) return;
    this.fifo[k][this.fifoW[k]] = v; this.fifoW[k] = (this.fifoW[k] + 1) & 31; this.fifoN[k]++;
  }
  fifoWrite16(k, v) { this.fifoWrite8(k, v & 0xff); this.fifoWrite8(k, v >> 8); }
  fifoWrite32(k, v) { for (let s = 0; s < 32; s += 8) this.fifoWrite8(k, (v >>> s) & 0xff); }

  /** Desbordamiento del timer t: cada FIFO asociado a ese timer consume una muestra. */
  timerOverflow(t) {
    const h = this.soundcnth;
    for (let k = 0; k < 2; k++) {
      const timer = (h >> (10 + k * 4)) & 1;
      if (timer !== t) continue;
      if (this.fifoN[k] > 0) {
        this.current[k] = this.fifo[k][this.fifoR[k]];
        this.fifoR[k] = (this.fifoR[k] + 1) & 31; this.fifoN[k]--;
      }
      this.sink?.directSample(k, this.current[k]);
      if (this.fifoN[k] <= 16) this.emu.dma.triggerFifo(k === 0 ? 0x040000a0 : 0x040000a4);
    }
  }
}
