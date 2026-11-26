/**
 * Teclado (GBATEK, "GBA Keypad Input"). KEYINPUT 0x04000130: bit a 0 = pulsado.
 * Orden de bits: A, B, Select, Start, Derecha, Izquierda, Arriba, Abajo, R, L.
 * KEYCNT 0x04000132: IRQ de teclado (bit 14), condición OR/AND (bit 15).
 */
import { IRQ } from './interrupts.js';

export const KEYS = Object.freeze({ A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 });

export class Keypad {
  constructor(irq) { this.irq = irq; this.state = 0x3ff; this.keycnt = 0; }
  set(key, pressed) {
    if (pressed) this.state &= ~(1 << key); else this.state |= 1 << key;
    // La cruceta no puede tener direcciones opuestas a la vez en el hardware real
    this.check();
  }
  get keyinput() { return this.state & 0x3ff; }
  check() {
    if (!(this.keycnt & 0x4000)) return;
    const sel = this.keycnt & 0x3ff, pressed = ~this.state & 0x3ff;
    const hit = this.keycnt & 0x8000 ? (pressed & sel) === sel && sel !== 0 : (pressed & sel) !== 0;
    if (hit) this.irq.request(IRQ.KEYPAD);
  }
}
