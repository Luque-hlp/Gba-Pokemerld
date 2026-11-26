/**
 * TileManager — conjuntos de tiles 8×8 decodificados a índices (64 bytes por tile).
 * La decodificación se hace una sola vez al registrar; dibujar es copiar índices.
 */
import { decodeTile, tileCount } from '../decoders/tiles.js';

export class TileManager {
  constructor() { this.sets = new Map(); }
  /** @param {Uint8Array} raw datos GBA 4bpp/8bpp */
  register(id, raw, bpp = 4) {
    const n = tileCount(raw.length, bpp);
    const indices = new Uint8Array(n * 64);
    const t = new Uint8Array(64);
    for (let i = 0; i < n; i++) indices.set(decodeTile(raw, i, bpp, t), i * 64);
    this.sets.set(id, { bpp, count: n, indices });
  }
  get(id) { const s = this.sets.get(id); if (!s) throw new Error(`Tileset "${id}" no registrado`); return s; }
  /** 64 índices del tile `n` (vista, sin copia). */
  tile(id, n) {
    const s = this.get(id);
    if (n < 0 || n >= s.count) throw new RangeError(`Tile ${n} fuera de "${id}" (${s.count} tiles)`);
    return s.indices.subarray(n * 64, n * 64 + 64);
  }
}
