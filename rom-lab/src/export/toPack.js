/**
 * Conversión de datos decodificados al formato "gba-asset-pack" v1 que consume el motor.
 * Uso previsto: recursos sobre los que se tienen derechos. El pack lleva su procedencia (`meta.source`)
 * y una licencia; si no se indica, queda "UNSPECIFIED" y el motor lo advierte al cargarlo.
 */
import { base64Encode, PACK_FORMAT, PACK_VERSION } from '../engine/AssetPack.js';
import { parseMapCell, NUM_METATILES_IN_PRIMARY, NUM_TILES_IN_PRIMARY } from '../decoders/metatile.js';

export const rgbaToHex = (c) => '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('');
const palette = (colors) => ({ colors: Array.from(colors.subarray(0, 16), rgbaToHex) });
const header = (meta) => ({ format: PACK_FORMAT, version: PACK_VERSION, meta: { license: 'UNSPECIFIED', ...meta } });

/** AnimCmd decodificado ({op,...}) → comando del pack. */
export const animCmdToPack = (c) => c.op === 'frame' ? { frame: c.image, duration: c.duration, ...(c.hflip && { hflip: true }), ...(c.vflip && { vflip: true }) }
  : c.op === 'end' ? { end: true } : c.op === 'jump' ? { jump: c.target } : { loop: c.count };

/**
 * @param {object} o id, tiles (Uint8Array 4bpp), palette (Uint32Array ≥16), frameWidth, frameHeight,
 *                   sequences (array de arrays de AnimCmd decodificados, opcional), meta
 */
export function spriteToPack({ id = 'sprite', tiles, palette: pal, frameWidth, frameHeight, sequences, meta = {} }) {
  const pack = { ...header(meta), palettes: { [id]: palette(pal) }, tilesets: { [id]: { bpp: 4, data: base64Encode(tiles) } },
    sprites: { [id]: { tileset: id, palette: id, frameWidth, frameHeight, mapping: '1d' } } };
  if (sequences?.length) pack.animations = { [id]: { sprite: id, sequences: sequences.map((s) => s.map(animCmdToPack)) } };
  return pack;
}

/**
 * Aplana un mapa de metatiles a dos capas de tiles 8×8 (inferior/superior) con 13 bancos de paleta.
 * Tileset combinado: tiles primarios en 0..511 (rellenados) + secundarios desde 512, igual que en VRAM.
 * @param {object} o id, mapBytes, width, height (en metatiles), pair (de buildTilesetPair), meta
 */
export function mapToPack({ id = 'map', mapBytes, width, height, pair, meta = {} }) {
  const combined = new Uint8Array(NUM_TILES_IN_PRIMARY * 32 + pair.secondary.tiles.length);
  combined.set(pair.primary.tiles.subarray(0, NUM_TILES_IN_PRIMARY * 32), 0);
  combined.set(pair.secondary.tiles, NUM_TILES_IN_PRIMARY * 32);
  const W = width * 2, H = height * 2, bottom = new Array(W * H).fill(0), top = new Array(W * H).fill(0);
  const missing = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id_ = parseMapCell(mapBytes[(y * width + x) * 2] | (mapBytes[(y * width + x) * 2 + 1] << 8)).metatile;
    const [src, local] = id_ < NUM_METATILES_IN_PRIMARY ? [pair.primary.metatiles, id_] : [pair.secondary.metatiles, id_ - NUM_METATILES_IN_PRIMARY];
    if ((local + 1) * 16 > src.length) { missing.add(id_); continue; }
    for (let k = 0; k < 8; k++) {
      const v = src[local * 16 + k * 2] | (src[local * 16 + k * 2 + 1] << 8);
      const q = k & 3, i = (y * 2 + (q >> 1)) * W + x * 2 + (q & 1);
      (k < 4 ? bottom : top)[i] = v;
    }
  }
  const palettes = {}; const banks = [];
  for (let b = 0; b < 13; b++) { palettes[`${id}_bg${b}`] = palette(pair.palette.subarray(b * 16, b * 16 + 16)); banks.push(`${id}_bg${b}`); }
  return {
    pack: { ...header(meta), palettes, tilesets: { [id]: { bpp: 4, data: base64Encode(combined) } },
      tilemaps: { [id]: { tileset: id, width: W, height: H, palettes: banks, layers: [{ entries: bottom }, { entries: top }] } } },
    missingMetatiles: [...missing],
  };
}
