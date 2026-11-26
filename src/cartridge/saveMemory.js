/**
 * Memorias de guardado del cartucho (GBATEK, "GBA Cart Backup").
 * - SRAM 32 KiB: lectura/escritura directa de bytes.
 * - Flash 64/128 KiB: máquina de estados de comandos (AA→5555, 55→2AAA, comando→5555):
 *     90 ID, F0 salir de ID, 80+10 borrar chip, 80+30 borrar sector (4 KiB), A0 escribir byte,
 *     B0 cambio de banco (solo 128 KiB). IDs según el juego: Macronix MX29L010 (0xC2, 0x09).
 * - EEPROM 512 B / 8 KiB: protocolo serie por DMA3 en 0x0D000000 (implementado en eeprom.js en fase 9).
 * Todas marcan `dirty` al cambiar para que el gestor de guardado persista los datos.
 */
export class Sram {
  constructor(size = 0x8000) { this.type = 'sram'; this.data = new Uint8Array(size).fill(0xff); this.dirty = false; }
  read8(a) { return this.data[a % this.data.length]; }
  write8(a, v) { this.data[a % this.data.length] = v; this.dirty = true; }
}

export class Flash {
  /** @param {number} size 0x10000 o 0x20000 */
  constructor(size = 0x20000, ids = size === 0x20000 ? [0xc2, 0x09] : [0x32, 0x1b]) {
    this.type = size === 0x20000 ? 'flash128' : 'flash64';
    this.data = new Uint8Array(size).fill(0xff);
    this.ids = ids; this.bank = 0; this.state = 0; this.idMode = false; this.mode = null; this.dirty = false;
    this.log = [];
  }
  read8(a) {
    a &= 0xffff;
    if (this.idMode && a < 2) return this.ids[a];
    return this.data[this.bank * 0x10000 + a];
  }
  write8(a, v) {
    a &= 0xffff;
    if (this.mode === 'write') { this.data[this.bank * 0x10000 + a] = v; this.mode = null; this.dirty = true; return; }
    if (this.mode === 'bank') { if (a === 0) this.bank = (v & 1) % (this.data.length >> 16); this.mode = null; return; }
    if (this.state === 0 && a === 0x5555 && v === 0xaa) { this.state = 1; return; }
    if (this.state === 1 && a === 0x2aaa && v === 0x55) { this.state = 2; return; }
    if (this.state === 2) {
      this.state = 0;
      if (this.mode === 'erase') {
        this.mode = null;
        if (a === 0x5555 && v === 0x10) { this.data.fill(0xff); this.dirty = true; this.log.push('erase-chip'); }
        else if (v === 0x30) { const base = this.bank * 0x10000 + (a & 0xf000); this.data.fill(0xff, base, base + 0x1000); this.dirty = true; }
        return;
      }
      if (a !== 0x5555) return;
      switch (v) {
        case 0x90: this.idMode = true; return;
        case 0xf0: this.idMode = false; return;
        case 0x80: this.mode = 'erase'; return;
        case 0xa0: this.mode = 'write'; return;
        case 0xb0: if (this.data.length > 0x10000) this.mode = 'bank'; return;
        default: return;
      }
    }
    if (v === 0xf0) { this.idMode = false; this.state = 0; return; }
    this.state = 0;
  }
}

/** Crea la memoria indicada por el identificador de biblioteca encontrado en la ROM. */
export function createSaveMemory(type) {
  switch (type) {
    case 'flash128': return new Flash(0x20000);
    case 'flash64': return new Flash(0x10000);
    case 'sram': return new Sram();
    default: return null;
  }
}
