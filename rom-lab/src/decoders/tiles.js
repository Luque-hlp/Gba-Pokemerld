/**
 * Tiles 8×8 y su disposición en imágenes indexadas. Fuente: GBATEK, "LCD VRAM Character Data".
 * Una "imagen indexada" es { width, height, pixels: Uint8Array (índice por píxel), paletteBank?: Uint8Array }.
 */

export const TILE_BYTES = { 4: 32, 8: 64 };

/** Número de tiles completos en `byteLength` bytes. */
export const tileCount = (byteLength, bpp) => Math.floor(byteLength / TILE_BYTES[bpp]);

/**
 * Decodifica un tile a 64 índices (fila a fila).
 * 4bpp: nibble bajo = píxel izquierdo. 8bpp: 1 byte por píxel.
 * @param {Uint8Array} bytes @param {number} tileIndex @param {4|8} bpp @param {Uint8Array} [out]
 */
export function decodeTile(bytes, tileIndex, bpp, out = new Uint8Array(64), baseOffset = 0) {
  const size = TILE_BYTES[bpp];
  if (!size) throw new RangeError(`bpp no soportado: ${bpp}`);
  const o = baseOffset + tileIndex * size;
  if (o < 0 || o + size > bytes.length) throw new RangeError(`Tile ${tileIndex} fuera de límites`);
  if (bpp === 4) for (let i = 0; i < 32; i++) { const b = bytes[o + i]; out[i * 2] = b & 15; out[i * 2 + 1] = b >> 4; }
  else out.set(bytes.subarray(o, o + 64));
  return out;
}

/**
 * Dibuja 64 índices de tile en una imagen indexada con volteos opcionales.
 * @param {{width:number,pixels:Uint8Array}} img
 */
export function blitTile(img, tile, px, py, hflip = false, vflip = false, { bank = 0, skipZero = false } = {}) {
  for (let y = 0; y < 8; y++) {
    const sy = vflip ? 7 - y : y;
    const row = (py + y) * img.width + px;
    for (let x = 0; x < 8; x++) {
      const v = tile[sy * 8 + (hflip ? 7 - x : x)];
      if (skipZero && v === 0) continue;
      img.pixels[row + x] = v;
      if (img.paletteBank) img.paletteBank[row + x] = bank;
    }
  }
}

/**
 * Dispone tiles consecutivos en una cuadrícula, fila a fila (equivale al mapeo OBJ 1D de un sprite
 * de `widthTiles` de ancho). El ancho NO se deduce: lo aporta la estructura que referencia los datos
 * o el usuario.
 * @param {Uint8Array} bytes @param {4|8} bpp @param {number} widthTiles
 * @param {object} [o] firstTile, count
 */
export function tilesToIndexedImage(bytes, bpp, widthTiles, { firstTile = 0, count } = {}) {
  if (!Number.isInteger(widthTiles) || widthTiles < 1) throw new RangeError('widthTiles debe ser un entero ≥ 1');
  const total = tileCount(bytes.length, bpp) - firstTile;
  const n = Math.max(0, Math.min(count ?? total, total));
  const heightTiles = Math.max(1, Math.ceil(n / widthTiles));
  const img = { width: widthTiles * 8, height: heightTiles * 8, pixels: new Uint8Array(widthTiles * 8 * heightTiles * 8), tiles: n };
  const t = new Uint8Array(64);
  for (let i = 0; i < n; i++) blitTile(img, decodeTile(bytes, firstTile + i, bpp, t), (i % widthTiles) * 8, Math.floor(i / widthTiles) * 8);
  return img;
}
