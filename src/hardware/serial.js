/**
 * Puerto serie sin nada conectado (GBATEK, "GBA Communication Ports").
 * - RCNT (0x134) en modo de propósito general (bit 15 = 1, bit 14 = 0): los pines configurados como
 *   entrada (bits de dirección 4–7 a 0) se leen en alto, porque las líneas tienen resistencias de
 *   pull-up y no hay nada conectado; los de salida devuelven lo escrito.
 * - SIOCNT (0x128): una transferencia con reloj interno (bit 0 = 1) termina tras su duración y
 *   recibe unos (SI en alto); con reloj externo no termina nunca, porque no hay otro aparato.
 *   En modo multijugador, SI en alto indica "no hay maestro": se marca error y los datos quedan a 0xFFFF.
 */
import { IRQ } from './interrupts.js';

export class Serial {
  constructor(irq, io) { this.irq = irq; this.io = io; this.rcnt = 0; this.siocnt = 0; this.pending = 0; this.transfers = 0; }

  readRcnt() {
    if ((this.rcnt & 0xc000) === 0x8000) {
      const dir = (this.rcnt >> 4) & 15;
      const pins = (this.rcnt & dir) | (~dir & 15); // entradas en alto
      return (this.rcnt & 0xfff0) | (pins & 15);
    }
    return this.rcnt;
  }
  writeRcnt(v) { this.rcnt = v & 0xc1ff; }

  readSiocnt() {
    const mode = this.#mode();
    let v = this.siocnt;
    if (mode === 'multi') v = (v & ~0x3c) | (1 << 2) | (1 << 3); // SI alto (sin maestro) y "no preparado"
    else if (mode === 'normal') v |= 1 << 2; // SI alto
    return v;
  }
  writeSiocnt(v, now) {
    this.siocnt = (this.siocnt & 0x0080) | (v & 0x7f7f) | (v & 0x0080);
    if (!(v & 0x80)) return;
    const mode = this.#mode();
    if (mode === 'normal' && (v & 1)) {
      // reloj interno: 8 o 32 bits a 256 kHz (bit 1 = 0) o 2 MHz
      const bits = v & 0x1000 ? 32 : 8;
      this.pending = now + bits * (v & 2 ? 8 : 64);
    } else if (mode === 'multi') {
      this.pending = now + 1000;
    }
  }
  #mode() {
    if (this.rcnt & 0x8000) return 'gp';
    const m = (this.siocnt >> 12) & 3;
    return m === 2 ? 'multi' : m === 3 ? 'uart' : 'normal';
  }
  /** Llamar periódicamente con el ciclo actual: completa la transferencia en curso. */
  update(now) {
    if (!this.pending || now < this.pending) return;
    this.pending = 0;
    const regs = this.io.regs;
    if (this.#mode() === 'multi') { for (let k = 0; k < 4; k++) regs[(0x120 >> 1) + k] = 0xffff; this.siocnt |= 0x40; } // bit 6: error
    else { regs[0x120 >> 1] = 0xffff; regs[0x122 >> 1] = 0xffff; regs[0x12a >> 1] = 0xffff; }
    this.siocnt &= ~0x80;
    this.transfers++;
    if (this.siocnt & 0x4000) this.irq.request(IRQ.SERIAL);
  }
}
