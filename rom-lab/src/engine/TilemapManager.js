/**
 * TilemapManager — capas de fondo con entradas en formato de fondo de texto GBA
 * (tile bits 0–9, hflip 10, vflip 11, banco de paleta 12–15). Las capas se componen a una imagen
 * indexada una vez; el color se aplica con la paleta actual (rápido ante fundidos).
 */
import { parseTextEntry } from '../decoders/tilemap.js';
import { blitTile } from '../decoders/tiles.js';
import { indexedToRGBA } from '../decoders/image.js';

export class TilemapManager {
  /** @param {import('./TileManager.js').TileManager} tiles @param {import('./PaletteManager.js').PaletteManager} palettes */
  constructor(tiles, palettes) { this.tiles = tiles; this.palettes = palettes; this.maps = new Map(); this.errors = []; }

  /** @param {{tileset:string,width:number,height:number,palettes:(string|null)[],layers:{entries:number[]}[]}} def */
  register(id, def) {
    const layers = def.layers.map((layer, li) => {
      const img = { width: def.width * 8, height: def.height * 8, pixels: new Uint8Array(def.width * def.height * 64), paletteBank: new Uint8Array(def.width * def.height * 64) };
      layer.entries.forEach((v, i) => {
        const e = parseTextEntry(v);
        let t;
        try { t = this.tiles.tile(def.tileset, e.tile); } catch (err) { this.errors.push(`${id}[capa ${li}] celda ${i}: ${err.message}`); return; }
        // índice 0 transparente en todas las capas (regla de hardware); el fondo se ve a través
        blitTile(img, t, (i % def.width) * 8, Math.floor(i / def.width) * 8, e.hflip, e.vflip, { bank: e.palette, skipZero: true });
      });
      return { img };
    });
    this.maps.set(id, { def, layers, cache: new Map() });
  }

  /** RGBA de una capa con la paleta vigente; cacheado por versión de paleta. */
  layerRGBA(id, layer = 0) {
    const m = this.maps.get(id); if (!m) throw new Error(`Tilemap "${id}" no registrado`);
    const key = `${layer}:${this.palettes.version}`;
    if (!m.cache.has(key)) {
      m.cache.clear();
      m.cache.set(key, indexedToRGBA(m.layers[layer].img, this.palettes.banks(m.def.palettes), { transparentZero: true }));
    }
    return m.cache.get(key);
  }
  size(id) { const d = this.maps.get(id).def; return { width: d.width * 8, height: d.height * 8, layers: d.layers.length }; }
}
