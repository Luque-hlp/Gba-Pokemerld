/**
 * PaletteManager — paletas de 16·n colores como Uint32Array RGBA (formato de ImageData en little-endian).
 * Permite modificar paletas en tiempo de ejecución (fundidos, ciclos de color): cada cambio incrementa
 * `version`, y los gestores que cachean imágenes la usan para invalidarse.
 */
import { packRGBA } from '../decoders/palette.js';

export const hexToRGBA = (h) => packRGBA(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

export class PaletteManager {
  constructor() { this.base = new Map(); this.current = new Map(); this.version = 0; }
  /** @param {string} id @param {string[]|Uint32Array} colors '#rrggbb' o RGBA empaquetado */
  register(id, colors) {
    const c = colors instanceof Uint32Array ? colors.slice() : Uint32Array.from(colors, hexToRGBA);
    this.base.set(id, c); this.current.set(id, c.slice()); this.version++;
  }
  has(id) { return this.current.has(id); }
  /** @returns {Uint32Array} colores actuales (no modificar directamente: usar set/fade) */
  get(id) { const p = this.current.get(id); if (!p) throw new Error(`Paleta "${id}" no registrada`); return p; }
  /** Concatena varias paletas en bancos de 16 (para tilemaps con varias paletas). null = banco vacío. */
  banks(ids) {
    const out = new Uint32Array(Math.max(1, ids.length) * 16);
    ids.forEach((id, i) => { if (id !== null) out.set(this.get(id).subarray(0, 16), i * 16); });
    return out;
  }
  setColor(id, index, rgba) { this.get(id)[index] = rgba >>> 0; this.version++; }
  /** Cambia un color de la paleta BASE y de la actual (persistente frente a fade/reset): ciclos de color. */
  setBase(id, index, rgba) { const b = this.base.get(id); if (!b) throw new Error(`Paleta "${id}" no registrada`); b[index] = rgba >>> 0; this.current.get(id)[index] = rgba >>> 0; this.version++; }
  /**
   * Mezcla hacia un color (como el registro BLDY del GBA): t ∈ [0,1]. Opera desde la paleta base.
   * @param {string[]} [ids] por defecto, todas
   */
  fade(t, target = 0xff000000, ids = [...this.base.keys()]) {
    const tr = target & 255, tg = (target >> 8) & 255, tb = (target >> 16) & 255;
    for (const id of ids) {
      const b = this.base.get(id), c = this.current.get(id);
      for (let i = 0; i < b.length; i++) {
        const r = b[i] & 255, g = (b[i] >> 8) & 255, bl = (b[i] >> 16) & 255;
        c[i] = packRGBA(Math.round(r + (tr - r) * t), Math.round(g + (tg - g) * t), Math.round(bl + (tb - bl) * t));
      }
    }
    this.version++;
  }
  reset(ids = [...this.base.keys()]) { for (const id of ids) this.current.set(id, this.base.get(id).slice()); this.version++; }
}
