/**
 * Metatiles y mapas de pokeemerald (ESPECÍFICO DEL JUEGO).
 * Fuentes (descompilación, versión inglesa; verificadas estructuralmente en la ROM con src/structures):
 *   include/fieldmap.h          NUM_TILES_IN_PRIMARY 512, NUM_METATILES_IN_PRIMARY 512,
 *                               NUM_PALS_IN_PRIMARY 6, NUM_PALS_TOTAL 13, NUM_TILES_PER_METATILE 8
 *   include/global.fieldmap.h   celda de mapa u16: metatile bits 0–9, colisión 10–11, elevación 12–15
 *   src/fieldmap.c              tiles primarios -> VRAM tile 0; secundarios -> tile 512;
 *                               paletas 0–5 del primario (color 0 forzado a negro), 6–12 del secundario
 * Metatile = 8 entradas de tilemap de texto (u16): 4 de capa inferior (2×2) + 4 de capa superior (2×2).
 */
import { parseTextEntry } from './tilemap.js';
import { decodeTile, blitTile } from './tiles.js';

export const NUM_TILES_IN_PRIMARY = 512;
export const NUM_METATILES_IN_PRIMARY = 512;
export const NUM_PALS_IN_PRIMARY = 6;
export const NUM_PALS_TOTAL = 13;

export const parseMapCell = (v) => ({ metatile: v & 0x3ff, collision: (v >> 10) & 3, elevation: (v >> 12) & 15 });

/**
 * Combina las dos mitades del "VRAM" de un mapa.
 * @param {{tiles:Uint8Array, metatiles:Uint8Array, palettes:Uint32Array}} primary  palettes: ≥ 6×16 colores
 * @param {{tiles:Uint8Array, metatiles:Uint8Array, palettes:Uint32Array}} secondary palettes: ≥ 13×16 colores
 */
export function buildTilesetPair(primary, secondary) {
  const pal = new Uint32Array(16 * 16);
  pal.set(primary.palettes.subarray(0, NUM_PALS_IN_PRIMARY * 16), 0);
  pal[0] = 0xff000000; // src/fieldmap.c: LoadPalette(&black, ...) para el color 0 del primario
  pal.set(secondary.palettes.subarray(NUM_PALS_IN_PRIMARY * 16, NUM_PALS_TOTAL * 16), NUM_PALS_IN_PRIMARY * 16);
  return { primary, secondary, palette: pal };
}

const tileSource = (pair, tile) => tile < NUM_TILES_IN_PRIMARY
  ? [pair.primary.tiles, tile] : [pair.secondary.tiles, tile - NUM_TILES_IN_PRIMARY];

/** Dibuja el metatile `id` (16×16) en `img` en (px, py). Devuelve los errores encontrados. */
export function drawMetatile(img, pair, id, px, py, errors) {
  const [mtBytes, local] = id < NUM_METATILES_IN_PRIMARY ? [pair.primary.metatiles, id] : [pair.secondary.metatiles, id - NUM_METATILES_IN_PRIMARY];
  const base = local * 16;
  if (base + 16 > mtBytes.length) { errors?.push(`Metatile ${id} fuera de la tabla`); return; }
  const t = new Uint8Array(64);
  for (let layer = 0; layer < 2; layer++) for (let k = 0; k < 4; k++) {
    const o = base + (layer * 4 + k) * 2;
    const e = parseTextEntry(mtBytes[o] | (mtBytes[o + 1] << 8));
    const [src, ti] = tileSource(pair, e.tile);
    try { decodeTile(src, ti, 4, t); } catch { errors?.push(`Tile ${e.tile} inexistente (metatile ${id})`); continue; }
    // Índice 0 transparente en ambas capas (GBATEK): donde no hay color se ve el backdrop,
    // que es el color 0 de la paleta 0 (la imagen se inicializa a índice 0 / banco 0).
    blitTile(img, t, px + (k & 1) * 8, py + (k >> 1) * 8, e.hflip, e.vflip, { bank: e.palette, skipZero: true });
  }
}

/** Renderiza un mapa completo (width × height celdas u16). */
export function renderMap(mapBytes, width, height, pair) {
  const img = { width: width * 16, height: height * 16, pixels: new Uint8Array(width * height * 256), paletteBank: new Uint8Array(width * height * 256) };
  const errors = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 2;
    if (o + 1 >= mapBytes.length) { errors.push(`Celda (${x},${y}) fuera de datos`); continue; }
    drawMetatile(img, pair, parseMapCell(mapBytes[o] | (mapBytes[o + 1] << 8)).metatile, x * 16, y * 16, errors);
  }
  return { img, errors: [...new Set(errors)] };
}
