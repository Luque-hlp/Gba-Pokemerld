import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bgr555ToRgb, decodePalette, packRGBA, grayscalePalette } from '../src/decoders/palette.js';
import { decodeTile, tilesToIndexedImage } from '../src/decoders/tiles.js';
import { parseTextEntry, packTextEntry, textBgEntryIndex, renderTextBg, renderAffineBg } from '../src/decoders/tilemap.js';
import { indexedToRGBA, cropIndexed } from '../src/decoders/image.js';
import { buildTilesetPair, renderMap, parseMapCell } from '../src/decoders/metatile.js';
import { parseAnimCmds, animTimeline } from '../src/decoders/anim.js';

const u16le = (arr) => { const b = new Uint8Array(arr.length * 2); arr.forEach((v, i) => { b[i * 2] = v & 255; b[i * 2 + 1] = v >> 8; }); return b; };

test('BGR555: canales y escalado 5→8', () => {
  assert.deepEqual(bgr555ToRgb(0x001f), [255, 0, 0]);
  assert.deepEqual(bgr555ToRgb(0x03e0), [0, 255, 0]);
  assert.deepEqual(bgr555ToRgb(0x7c00), [0, 0, 255]);
  assert.deepEqual(bgr555ToRgb(0x4210), [132, 132, 132]); // 16 → (16<<3)|(16>>2)
  const p = decodePalette(u16le([0x001f, 0x8000]), 0, 2);
  assert.equal(p.colors[0], packRGBA(255, 0, 0)); assert.equal(p.bit15Set, 1);
  assert.throws(() => decodePalette(new Uint8Array(4), 0, 16), RangeError);
  assert.equal(grayscalePalette(16)[15], packRGBA(255, 255, 255));
});

test('tile 4bpp: nibble bajo = píxel izquierdo', () => {
  const t = new Uint8Array(32); t[0] = 0x21; t[3] = 0xf0;
  const px = decodeTile(t, 0, 4);
  assert.deepEqual([...px.subarray(0, 8)], [1, 2, 0, 0, 0, 0, 0, 15]);
});

test('tile 8bpp y disposición en cuadrícula 1D', () => {
  const data = new Uint8Array(64 * 3); for (let t = 0; t < 3; t++) data.fill(t + 1, t * 64, t * 64 + 64);
  const img = tilesToIndexedImage(data, 8, 2);
  assert.equal(img.width, 16); assert.equal(img.height, 16); assert.equal(img.tiles, 3);
  assert.equal(img.pixels[0], 1); assert.equal(img.pixels[8], 2); assert.equal(img.pixels[16 * 8], 3); assert.equal(img.pixels[16 * 8 + 8], 0);
  assert.throws(() => tilesToIndexedImage(data, 8, 0), RangeError);
});

test('entrada de tilemap: ida y vuelta', () => {
  for (const e of [{ tile: 0, hflip: false, vflip: false, palette: 0 }, { tile: 1023, hflip: true, vflip: true, palette: 15 }, { tile: 77, hflip: true, vflip: false, palette: 3 }])
    assert.deepEqual(parseTextEntry(packTextEntry(e)), e);
});

test('orden de screenblocks en fondos de 64 de ancho', () => {
  assert.equal(textBgEntryIndex(31, 0, 64), 31);
  assert.equal(textBgEntryIndex(32, 0, 64), 1024);       // SB1
  assert.equal(textBgEntryIndex(0, 32, 64), 2048);       // SB2
  assert.equal(textBgEntryIndex(0, 32, 32), 1024);       // 32×64: SB1 debajo
});

test('render de fondo de texto con volteo y banco de paleta', () => {
  const tile = new Uint8Array(32); tile[0] = 0x01;               // píxel (0,0) = 1
  const map = u16le([packTextEntry({ tile: 0, hflip: true, palette: 2 })]);
  const errs = [];
  const img = renderTextBg(tile, map, { widthTiles: 1, heightTiles: 1, screenblocks: false, onError: (e) => errs.push(e) });
  assert.equal(img.pixels[7], 1); assert.equal(img.pixels[0], 0); assert.equal(img.paletteBank[7], 2);
  renderTextBg(tile, u16le([5]), { widthTiles: 1, heightTiles: 1, screenblocks: false, onError: (e) => errs.push(e) });
  assert.match(errs[0], /Tile 5 inexistente/);
  const aff = renderAffineBg(new Uint8Array(64).fill(9), Uint8Array.from([0]), 1);
  assert.equal(aff.pixels[63], 9);
});

test('indexado → RGBA: bancos, transparencia y fuera de paleta', () => {
  const img = { width: 3, height: 1, pixels: Uint8Array.from([0, 1, 1]), paletteBank: Uint8Array.from([0, 0, 1]) };
  const pal = new Uint32Array(17); pal[1] = 0xff0000ff; pal[16 + 1] = 0xff00ff00;
  const r = indexedToRGBA(img, pal, { transparentZero: true });
  const u = new Uint32Array(r.data.buffer);
  assert.equal(u[0], 0); assert.equal(u[1], 0xff0000ff); assert.equal(u[2], 0xffff00ff); assert.equal(r.outOfPalette, 1);
  assert.deepEqual([...cropIndexed({ width: 4, height: 2, pixels: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]) }, 1, 1, 2, 1).pixels], [5, 6]);
});

test('metatiles: tiles primarios/secundarios, paletas y capa superior transparente', () => {
  const solid = (v) => new Uint8Array(32).fill(v * 0x11);
  const primary = { tiles: solid(1), metatiles: u16le([0, 0, 0, 0, 0, 0, 0, 0]), palettes: new Uint32Array(256).fill(0xff111111) };
  // metatile 512 (= secundario 0): capa inferior tile 512 (sec. 0, paleta 6); capa superior tile 0 con índice 1 solo en esquina
  const secTiles = solid(2);
  const top = new Uint8Array(32); top[0] = 0x03;
  const prim2 = { ...primary, tiles: new Uint8Array([...solid(1), ...top]) };
  const secondary = { tiles: secTiles, metatiles: u16le([512 | (6 << 12), 512 | (6 << 12), 512 | (6 << 12), 512 | (6 << 12), 1, 0, 0, 0].map((v, i) => (i === 4 ? 1 : i > 4 ? (1 << 12) : v))), palettes: new Uint32Array(256).fill(0xff222222) };
  const pair = buildTilesetPair(prim2, secondary);
  assert.equal(pair.palette[0], 0xff000000);              // color 0 forzado a negro
  assert.equal(pair.palette[6 * 16 + 2], 0xff222222);       // paleta 6 viene del secundario
  const { img, errors } = renderMap(u16le([512]), 1, 1, pair);
  assert.deepEqual(errors, []);
  assert.equal(img.pixels[0], 3);                         // capa superior tile 1, píxel (0,0)=3
  assert.equal(img.pixels[1], 2); assert.equal(img.paletteBank[1], 6); // debajo: secundario, paleta 6
  assert.deepEqual(parseMapCell(0xf7ff), { metatile: 0x3ff, collision: 1, elevation: 15 });
  assert.match(renderMap(u16le([700]), 1, 1, pair).errors[0], /Metatile 700 fuera/);
});

test('AnimCmd: frame, loop, jump y end', () => {
  const w = (lo, hi) => [lo & 255, (lo >> 8) & 255, hi & 255, (hi >> 8) & 255];
  const bytes = Uint8Array.from([...w(3, 10 | 64), ...w(0xfffd, 2), ...w(0, 5), ...w(0xfffe, 1)]);
  const cmds = parseAnimCmds(bytes, 0);
  assert.deepEqual(cmds, [{ op: 'frame', image: 3, duration: 10, hflip: true, vflip: false }, { op: 'loop', count: 2 }, { op: 'frame', image: 0, duration: 5, hflip: false, vflip: false }, { op: 'jump', target: 1 }]);
  assert.deepEqual(animTimeline(cmds).map((f) => f.ticks), [10, 5]);
  assert.deepEqual(parseAnimCmds(Uint8Array.from(w(0xffff, 0)), 0), [{ op: 'end' }]);
  assert.throws(() => parseAnimCmds(new Uint8Array(8), 0, 2), /Sin END/);
});
