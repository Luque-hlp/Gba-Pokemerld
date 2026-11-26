/**
 * DMA 0–3 (GBATEK, "GBA DMA Transfers").
 * DMAxSAD/DAD (direcciones), DMAxCNT_L (unidades; 0 = máximo), DMAxCNT_H (control):
 *   bits 5–6 destino (inc, dec, fijo, inc+recarga), 7–8 origen (inc, dec, fijo),
 *   bit 9 repetir, bit 10 32 bits, bits 12–13 momento (inmediato, VBlank, HBlank, especial),
 *   bit 14 IRQ al terminar, bit 15 habilitado.
 * Especial: DMA1/DMA2 = FIFO de sonido (4 palabras de 32 bits, destino fijo), DMA3 = captura de vídeo.
 * Las transferencias se ejecutan de forma instantánea; los ciclos consumidos se devuelven para
 * cargarlos al contador global (la CPU está parada durante el DMA en el hardware real).
 */
import { IRQ } from './interrupts.js';

const SRC_MASK = [0x07ffffff, 0x0fffffff, 0x0fffffff, 0x0fffffff];
const DST_MASK = [0x07ffffff, 0x07ffffff, 0x07ffffff, 0x0fffffff];
const COUNT_MAX = [0x4000, 0x4000, 0x4000, 0x10000];

export const DMA_TIMING = Object.freeze({ IMMEDIATE: 0, VBLANK: 1, HBLANK: 2, SPECIAL: 3 });

export class DMA {
  constructor(bus, irq) {
    this.bus = bus; this.irq = irq;
    this.ch = Array.from({ length: 4 }, () => ({ sad: 0, dad: 0, cnt: 0, control: 0, src: 0, dst: 0, count: 0, active: false }));
    this.cyclesUsed = 0;
    this.log = null; // función opcional de depuración
  }

  writeControl(i, value) {
    const c = this.ch[i];
    const was = c.control & 0x8000;
    c.control = value & (i === 3 ? 0xffe0 : 0xf7e0);
    if (!(value & 0x8000)) { c.active = false; return; }
    if (!was) {
      // Flanco de habilitación: se latchean las direcciones y el contador internos
      c.src = c.sad & SRC_MASK[i]; c.dst = c.dad & DST_MASK[i];
      c.count = (c.cnt & (COUNT_MAX[i] - 1)) || COUNT_MAX[i];
      c.active = true;
      if (((value >> 12) & 3) === DMA_TIMING.IMMEDIATE) this.run(i);
    }
  }

  /** Dispara las DMA programadas para un momento (VBlank/HBlank). */
  trigger(timing) {
    for (let i = 0; i < 4; i++) { const c = this.ch[i]; if (c.active && ((c.control >> 12) & 3) === timing) this.run(i); }
  }

  /** Petición del FIFO de sonido A (fifo = 0) o B (fifo = 1). */
  triggerFifo(fifoAddr) {
    for (const i of [1, 2]) {
      const c = this.ch[i];
      if (c.active && ((c.control >> 12) & 3) === DMA_TIMING.SPECIAL && (c.dad & 0x0fffffff) === fifoAddr) this.run(i, true);
    }
  }

  run(i, fifo = false) {
    const c = this.ch[i], bus = this.bus;
    const word = fifo || !!(c.control & 0x400);
    const size = word ? 4 : 2;
    const dstMode = fifo ? 2 : (c.control >> 5) & 3;
    const srcMode = (c.control >> 7) & 3;
    const count = fifo ? 4 : c.count;
    const dStep = dstMode === 0 || dstMode === 3 ? size : dstMode === 1 ? -size : 0;
    const sStep = srcMode === 0 ? size : srcMode === 1 ? -size : 0;
    let src = c.src, dst = c.dst;
    this.log?.(i, src, dst, count, word);
    if (word) { src &= ~3; dst &= ~3; for (let k = 0; k < count; k++) { bus.write32(dst, bus.read32(src)); src += sStep; dst += dStep; } }
    else { src &= ~1; dst &= ~1; for (let k = 0; k < count; k++) { bus.write16(dst, bus.read16(src)); src += sStep; dst += dStep; } }
    this.cyclesUsed += 2 + count * (word ? 2 : 1) * 2;
    c.src = src >>> 0;
    c.dst = (dstMode === 3 ? c.dad & DST_MASK[i] : dst) >>> 0;
    if (c.control & 0x4000) this.irq.request(IRQ.DMA0 << i);
    const timing = (c.control >> 12) & 3;
    if ((c.control & 0x200) && timing !== DMA_TIMING.IMMEDIATE) {
      if (!fifo) c.count = (c.cnt & (COUNT_MAX[i] - 1)) || COUNT_MAX[i];
    } else {
      c.active = false; c.control &= 0x7fff; // fin: se borra el bit de habilitación
    }
  }
}
