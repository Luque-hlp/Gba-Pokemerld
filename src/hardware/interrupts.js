/**
 * Controlador de interrupciones (GBATEK, "GBA Interrupt Control").
 * IE 0x04000200, IF 0x04000202 (escribir 1 borra), IME 0x04000208.
 */
export const IRQ = Object.freeze({
  VBLANK: 1 << 0, HBLANK: 1 << 1, VCOUNT: 1 << 2,
  TIMER0: 1 << 3, TIMER1: 1 << 4, TIMER2: 1 << 5, TIMER3: 1 << 6,
  SERIAL: 1 << 7, DMA0: 1 << 8, DMA1: 1 << 9, DMA2: 1 << 10, DMA3: 1 << 11,
  KEYPAD: 1 << 12, GAMEPAK: 1 << 13,
});

export class Interrupts {
  constructor() { this.ie = 0; this.if = 0; this.ime = 0; this.halted = false; this.stopped = false; this.counts = new Uint32Array(14); }
  request(mask) {
    this.if |= mask;
    for (let i = 0; i < 14; i++) if (mask & (1 << i)) this.counts[i]++;
    if (this.ie & mask) this.halted = false; // HALT termina con (IE & IF) != 0, aunque IME = 0
  }
  /** ¿Debe la CPU entrar en la excepción IRQ? (falta comprobar el bit I del CPSR, en la CPU) */
  pending() { return (this.ime & 1) !== 0 && (this.ie & this.if) !== 0; }
  acknowledge(mask) { this.if &= ~mask; }
}
