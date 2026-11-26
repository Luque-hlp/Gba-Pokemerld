/**
 * Timers 0–3 (GBATEK, "GBA Timers"). TMxCNT_L (contador/recarga) y TMxCNT_H (control):
 * bits 0–1 prescaler (1, 64, 256, 1024), bit 2 cascada (cuenta desbordamientos del timer anterior),
 * bit 6 IRQ, bit 7 habilitado. Al habilitarse se carga el valor de recarga.
 *
 * Evaluación perezosa: el contador se calcula a partir de los ciclos transcurridos; el emulador
 * pregunta por el próximo desbordamiento para programar el evento con exactitud de ciclo.
 */
import { IRQ } from './interrupts.js';

const PRESCALE = [0, 6, 8, 10]; // desplazamiento: 1, 64, 256, 1024 ciclos por cuenta

export class Timers {
  constructor(irq) {
    this.irq = irq;
    this.onOverflow = null; // (index) => void, para el FIFO de audio
    this.t = Array.from({ length: 4 }, () => ({ reload: 0, control: 0, counter: 0, enabled: false, cascade: false, shift: 0, frac: 0 }));
    this.lastCycle = 0;
  }

  /** Avanza todos los timers hasta `now` (ciclo absoluto). */
  sync(now) {
    let elapsed = now - this.lastCycle;
    if (elapsed <= 0) return;
    this.lastCycle = now;
    for (let i = 0; i < 4; i++) {
      const t = this.t[i];
      if (!t.enabled || t.cascade) continue;
      t.frac += elapsed;
      const ticks = t.frac >> t.shift;
      if (!ticks) continue;
      t.frac -= ticks << t.shift;
      this.#add(i, ticks);
    }
  }

  #add(i, ticks) {
    const t = this.t[i];
    let c = t.counter + ticks;
    let overflows = 0;
    while (c >= 0x10000) { c = c - 0x10000 + t.reload; overflows++; }
    t.counter = c;
    if (!overflows) return;
    for (let k = 0; k < overflows; k++) {
      if (t.control & 0x40) this.irq.request(IRQ.TIMER0 << i);
      this.onOverflow?.(i);
    }
    if (i < 3) { const n = this.t[i + 1]; if (n.enabled && n.cascade) this.#add(i + 1, overflows); }
  }

  /** Ciclos hasta el próximo desbordamiento de cualquier timer no en cascada (Infinity si ninguno). */
  cyclesUntilOverflow() {
    let best = Infinity;
    for (const t of this.t) {
      if (!t.enabled || t.cascade) continue;
      const remaining = ((0x10000 - t.counter) << t.shift) - t.frac;
      if (remaining < best) best = remaining;
    }
    return best;
  }

  read(i, high, now) {
    this.sync(now);
    return high ? this.t[i].control : this.t[i].counter & 0xffff;
  }

  write(i, high, value, now) {
    this.sync(now);
    const t = this.t[i];
    if (!high) { t.reload = value & 0xffff; return; }
    const wasEnabled = t.enabled;
    t.control = value & 0xc7;
    t.enabled = !!(value & 0x80);
    t.cascade = i > 0 && !!(value & 0x04);
    t.shift = PRESCALE[value & 3];
    if (t.enabled && !wasEnabled) { t.counter = t.reload; t.frac = 0; }
  }
}
