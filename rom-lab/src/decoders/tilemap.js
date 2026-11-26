/**
 * Tilemaps de fondos. Fuente: GBATEK, "LCD VRAM BG Screen Data Format".
 * Fondo de texto: u16 por entrada = tile (bits 0–9), hflip (10), vflip (11), paleta (12–15).
 * Fondo afín: u8 por entrada = tile.
 */
import { decodeTile, blitTile } from './tiles.js';

export function parseTextEntry(v) {
  return { tile: v & 0x3ff, hflip: !!(v & 0x400), vflip: !!(v & 0x800), palette: (v >> 12) & 15 };
}
export const packTextEntry = ({ tile, hflip = false, vflip = false, palette = 0 }) =>
  (tile & 0x3ff) | (hflip ? 0x400 : 0) | (vflip ? 0x800 : 0) | ((palette & 15) << 12);

/**
 * Índice de entrada dentro de los datos de mapa para la celda (x, y) de un fondo de texto de
 * widthTiles × heightTiles. Los fondos mayores de 32 se componen de screenblocks de 32×32 en orden
 * de bloque (GBATEK): SB0 arriba-izq, SB1 arriba-der (si ancho 64), SB2/SB3 abajo.
 */
export function textBgEntryIndex(x, y, widthTiles) {
  const sbx = x >> 5, sby = y >> 5;
  const sbPerRow = widthTiles > 32 ? 2 : 1;
  return (sby * sbPerRow + sbx) * 1024 + (y & 31) * 32 + (x & 31);
}

/**
 * Renderiza un fondo de texto a imagen indexada con banco de paleta por píxel.
 * @param {Uint8Array} tileBytes datos de tiles (charblock)
 * @param {Uint8Array} mapBytes entradas u16 LE
 * @param {object} o widthTiles, heightTiles (32|64), bpp (4|8), screenblocks (true = orden GBA; false = filas lineales)
 */
export function renderTextBg(tileBytes, mapBytes, { widthTiles, heightTiles, bpp = 4, screenblocks = true, onError } = {}) {
  const img = { width: widthTiles * 8, height: heightTiles * 8, pixels: new Uint8Array(widthTiles * heightTiles * 64), paletteBank: new Uint8Array(widthTiles * heightTiles * 64) };
  const t = new Uint8Array(64);
  for (let y = 0; y < heightTiles; y++) for (let x = 0; x < widthTiles; x++) {
    const idx = screenblocks ? textBgEntryIndex(x, y, widthTiles) : y * widthTiles + x;
    if (idx * 2 + 1 >= mapBytes.length) { onError?.(`Entrada de mapa ${idx} fuera de datos`); continue; }
    const e = parseTextEntry(mapBytes[idx * 2] | (mapBytes[idx * 2 + 1] << 8));
    try { decodeTile(tileBytes, e.tile, bpp, t); } catch { onError?.(`Tile ${e.tile} inexistente en (${x},${y})`); continue; }
    blitTile(img, t, x * 8, y * 8, e.hflip, e.vflip, { bank: bpp === 4 ? e.palette : 0 });
  }
  return img;
}

/** Fondo afín: entradas u8, siempre 8bpp, sin volteo ni paleta por tile. */
export function renderAffineBg(tileBytes, mapBytes, sizeTiles) {
  const img = { width: sizeTiles * 8, height: sizeTiles * 8, pixels: new Uint8Array(sizeTiles * sizeTiles * 64) };
  const t = new Uint8Array(64);
  for (let i = 0; i < sizeTiles * sizeTiles && i < mapBytes.length; i++) blitTile(img, decodeTile(tileBytes, mapBytes[i], 8, t), (i % sizeTiles) * 8, Math.floor(i / sizeTiles) * 8);
  return img;
}
