/**
 * Síntesis de sonido del GBA (GBATEK, "GBA Sound Channel 1–4", "DMA Sound A/B", "Sound Control").
 * Genera muestras estéreo a SAMPLE_RATE a partir del tiempo de CPU: cada 16 777 216 / SAMPLE_RATE ciclos
 * se toma una muestra del estado de los 4 canales PSG y de los 2 canales Direct Sound.
 *
 *  - Canales 1 y 2: onda cuadrada (ciclo de trabajo 12,5/25/50/75 %), envolvente, longitud; el 1 con barrido.
 *    Frecuencia = 131072 / (2048 − x) Hz.
 *  - Canal 3: onda programable de 32 muestras de 4 bits (2 bancos), volumen 0/25/50/75/100 %.
 *    Frecuencia de muestra = 2097152 / (2048 − x) Hz.
 *  - Canal 4: ruido con LFSR de 15 o 7 bits; frecuencia = 524288 / r / 2^(s+1) Hz (r = 0 → 0,5).
 *  - Secuenciador a 512 Hz: longitud a 256 Hz, barrido a 128 Hz, envolvente a 64 Hz.
 *  - Direct Sound A/B: la muestra de 8 bits con signo vigente (la mantiene el FIFO, ver apu.js).
 * La mezcla final es una aproximación normalizada en coma flotante del mezclador analógico.
 */
export const SAMPLE_RATE = 32768;
const CYCLES_PER_SAMPLE = 16777216 / SAMPLE_RATE; // 512
const DUTY = [0.125, 0.25, 0.5, 0.75];

function makeChannel() {
  return { on: false, freq: 0, phase: 0, duty: 2, length: 0, lengthOn: false, vol: 0, envDir: 0, envStep: 0, envTimer: 0,
    sweepTime: 0, sweepDir: 0, sweepShift: 0, sweepTimer: 0, shadow: 0, lfsr: 0x7fff, narrow: false, noiseRate: 0, noiseAcc: 0, waveVol: 0, wavePos: 0 };
}

export class SoundSynth {
  constructor(apu, capacity = 32768) {
    this.apu = apu;
    this.ch = [makeChannel(), makeChannel(), makeChannel(), makeChannel()];
    this.wave = new Uint8Array(32); // 2 bancos × 16 bytes (0x04000090–9F expone el banco no seleccionado)
    this.direct = [0, 0];
    this.buffer = new Float32Array(capacity * 2); // anillo intercalado L/R
    this.capacity = capacity; this.w = 0; this.r = 0;
    this.cycleAcc = 0; this.seqAcc = 0; this.seqStep = 0;
    this.volume = 1;
  }
  get available() { return (this.w - this.r + this.capacity) % this.capacity; }
  activeMask() { let m = 0; for (let i = 0; i < 4; i++) if (this.ch[i].on) m |= 1 << i; return m; }
  directSample(k, v) { this.direct[k] = v; }

  regs(off) { return this.apu.regs[(off - 0x60) >> 1]; }

  write16(off, v) {
    const c = this.ch;
    switch (off) {
      case 0x60: c[0].sweepShift = v & 7; c[0].sweepDir = (v >> 3) & 1; c[0].sweepTime = (v >> 4) & 7; break;
      case 0x62: case 0x68: { const k = off === 0x62 ? 0 : 1; c[k].length = 64 - (v & 63); c[k].duty = (v >> 6) & 3; break; }
      case 0x64: case 0x6c: {
        const k = off === 0x64 ? 0 : 1, ch = c[k];
        ch.freq = v & 0x7ff; ch.lengthOn = (v & 0x4000) !== 0;
        if (v & 0x8000) this.#trigger(k);
        break;
      }
      case 0x70: if (!(v & 0x80)) c[2].on = false; break;
      case 0x72: c[2].length = 256 - (v & 0xff); break;
      case 0x74: c[2].freq = v & 0x7ff; c[2].lengthOn = (v & 0x4000) !== 0; if (v & 0x8000) this.#trigger(2); break;
      case 0x78: c[3].length = 64 - (v & 63); break;
      case 0x7c: c[3].lengthOn = (v & 0x4000) !== 0; if (v & 0x8000) this.#trigger(3); break;
      case 0x84: if (!(v & 0x80)) for (const ch of c) ch.on = false; break;
      default:
        if (off >= 0x90 && off < 0xa0) { // RAM de onda: se escribe el banco NO seleccionado
          const bank = (this.regs(0x70) >> 6) & 1, base = (bank ^ 1) * 16 + (off - 0x90);
          this.wave[base] = v & 0xff; this.wave[base + 1] = v >> 8;
        }
    }
  }

  #envelopeRegs(k) { return k === 0 ? this.regs(0x62) : k === 1 ? this.regs(0x68) : this.regs(0x78); }

  #trigger(k) {
    const ch = this.ch[k];
    ch.on = true; ch.phase = 0;
    if (k === 2) {
      if (!(this.regs(0x70) & 0x80)) { ch.on = false; return; }
      if (ch.length === 0) ch.length = 256;
      ch.wavePos = 0;
      return;
    }
    if (ch.length === 0) ch.length = 64;
    const env = this.#envelopeRegs(k);
    ch.vol = env >> 12; ch.envDir = (env >> 11) & 1; ch.envStep = (env >> 8) & 7; ch.envTimer = ch.envStep;
    if (ch.vol === 0 && ch.envDir === 0) ch.on = false; // DAC apagado
    if (k === 0) { ch.shadow = ch.freq; ch.sweepTimer = ch.sweepTime || 8; }
    if (k === 3) {
      const cnt = this.regs(0x7c);
      ch.narrow = (cnt & 8) !== 0; ch.lfsr = ch.narrow ? 0x7f : 0x7fff;
      const r = cnt & 7, s = (cnt >> 4) & 15;
      ch.noiseRate = (r === 0 ? 1048576 : 524288 / r) / Math.pow(2, s + 1);
      ch.noiseAcc = 0;
    }
  }

  /** Secuenciador de tramas (512 Hz). */
  #sequencer() {
    const step = this.seqStep = (this.seqStep + 1) & 7;
    if (!(step & 1)) for (const ch of this.ch) if (ch.on && ch.lengthOn && --ch.length <= 0) ch.on = false; // 256 Hz
    if (step === 2 || step === 6) { // barrido 128 Hz
      const ch = this.ch[0];
      if (ch.on && ch.sweepTime && --ch.sweepTimer <= 0) {
        ch.sweepTimer = ch.sweepTime;
        const delta = ch.shadow >> ch.sweepShift;
        const nf = ch.sweepDir ? ch.shadow - delta : ch.shadow + delta;
        if (nf > 2047) ch.on = false;
        else if (ch.sweepShift) { ch.shadow = nf; ch.freq = nf; }
      }
    }
    if (step === 7) for (const k of [0, 1, 3]) { // envolvente 64 Hz
      const ch = this.ch[k];
      if (!ch.on || !ch.envStep) continue;
      if (--ch.envTimer <= 0) { ch.envTimer = ch.envStep; if (ch.envDir && ch.vol < 15) ch.vol++; else if (!ch.envDir && ch.vol > 0) ch.vol--; }
    }
  }

  /** Avanza `cycles` ciclos de CPU generando las muestras correspondientes. */
  advance(cycles) {
    this.cycleAcc += cycles;
    while (this.cycleAcc >= CYCLES_PER_SAMPLE) {
      this.cycleAcc -= CYCLES_PER_SAMPLE;
      this.seqAcc += CYCLES_PER_SAMPLE;
      if (this.seqAcc >= 32768) { this.seqAcc -= 32768; this.#sequencer(); } // 16 777 216 / 512 Hz
      this.#emit();
    }
  }

  #emit() {
    const cntx = this.regs(0x84);
    let L = 0, R = 0;
    if (cntx & 0x80) {
      const dt = 1 / SAMPLE_RATE;
      const out = [0, 0, 0, 0];
      for (let k = 0; k < 2; k++) {
        const ch = this.ch[k];
        if (!ch.on) continue;
        const hz = 131072 / (2048 - ch.freq);
        ch.phase = (ch.phase + hz * dt) % 1;
        out[k] = (ch.phase < DUTY[ch.duty] ? 1 : -1) * (ch.vol / 15);
      }
      { // canal 3
        const ch = this.ch[2];
        const c3 = this.regs(0x70), h3 = this.regs(0x72);
        if (ch.on && (c3 & 0x80)) {
          const rate = 2097152 / (2048 - ch.freq);
          ch.phase += rate * dt;
          const dims64 = (c3 & 0x20) !== 0, bank = (c3 >> 6) & 1;
          const len = dims64 ? 64 : 32;
          while (ch.phase >= 1) { ch.phase -= 1; ch.wavePos = (ch.wavePos + 1) % len; }
          const pos = ch.wavePos, b = dims64 ? (pos >> 5) ^ bank : bank;
          const byte = this.wave[b * 16 + ((pos & 31) >> 1)];
          const s = (pos & 1) ? byte & 15 : byte >> 4;
          const vol = h3 & 0x8000 ? 0.75 : [0, 1, 0.5, 0.25][(h3 >> 13) & 3];
          out[2] = ((s / 7.5) - 1) * vol;
        }
      }
      { // canal 4
        const ch = this.ch[3];
        if (ch.on) {
          ch.noiseAcc += ch.noiseRate * dt;
          while (ch.noiseAcc >= 1) {
            ch.noiseAcc -= 1;
            const bit = (ch.lfsr ^ (ch.lfsr >> 1)) & 1;
            ch.lfsr = (ch.lfsr >> 1) | (bit << (ch.narrow ? 6 : 14));
          }
          out[3] = (ch.lfsr & 1 ? -1 : 1) * (ch.vol / 15);
        }
      }
      const cntl = this.regs(0x80), cnth = this.regs(0x82);
      const psgScale = [0.25, 0.5, 1, 0][cnth & 3];
      const volR = (cntl & 7) / 7, volL = ((cntl >> 4) & 7) / 7;
      for (let k = 0; k < 4; k++) {
        if (cntl & (0x100 << k)) R += out[k] * volR * psgScale;
        if (cntl & (0x1000 << k)) L += out[k] * volL * psgScale;
      }
      L *= 0.25; R *= 0.25; // 4 canales PSG
      for (let k = 0; k < 2; k++) {
        const v = (this.direct[k] / 128) * ((cnth >> (2 + k)) & 1 ? 1 : 0.5);
        if (cnth & (0x100 << (k * 4))) R += v * 0.5;
        if (cnth & (0x200 << (k * 4))) L += v * 0.5;
      }
    }
    const i = this.w * 2;
    this.buffer[i] = L * this.volume; this.buffer[i + 1] = R * this.volume;
    this.w = (this.w + 1) % this.capacity;
    if (this.w === this.r) this.r = (this.r + 1) % this.capacity; // desbordamiento: se descarta lo más antiguo
  }

  /** Extrae hasta `n` muestras estéreo (para la salida de audio). */
  read(outL, outR, n) {
    let k = 0;
    for (; k < n && this.r !== this.w; k++) {
      outL[k] = this.buffer[this.r * 2]; outR[k] = this.buffer[this.r * 2 + 1];
      this.r = (this.r + 1) % this.capacity;
    }
    return k;
  }
}
