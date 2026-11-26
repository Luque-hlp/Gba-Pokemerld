import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Encode, base64Decode, validatePack } from '../src/engine/AssetPack.js';
import { PaletteManager, hexToRGBA } from '../src/engine/PaletteManager.js';
import { TileManager } from '../src/engine/TileManager.js';
import { TilemapManager } from '../src/engine/TilemapManager.js';
import { AnimationPlayer, AnimationManager } from '../src/engine/AnimationManager.js';
import { SpriteManager } from '../src/engine/SpriteManager.js';
import { Engine } from '../src/engine/Engine.js';
import { randomBytes } from './helpers.js';

const pal16 = (base) => Array.from({ length: 16 }, (_, i) => '#' + ((base + i * 0x0f0f0f) & 0xffffff).toString(16).padStart(6, '0'));
const solidTiles = (...vals) => { const b = new Uint8Array(vals.length * 32); vals.forEach((v, i) => b.fill(v * 0x11, i * 32, i * 32 + 32)); return b; };

test('base64 propio: ida y vuelta y errores', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) { const d = randomBytes(n, n + 1); assert.deepEqual(base64Decode(base64Encode(d)), d); }
  assert.equal(base64Encode(Uint8Array.from([0x4d, 0x61, 0x6e])), 'TWFu');
  assert.throws(() => base64Decode('abc'), /inválido/);
});

/** Pack mínimo válido, de contenido sintético. */
export function samplePack() {
  return {
    format: 'gba-asset-pack', version: 1, meta: { name: 'test', license: 'CC0-1.0' },
    palettes: { p0: { colors: pal16(0x102030) } },
    tilesets: { t: { bpp: 4, data: base64Encode(solidTiles(1, 2, 3, 4, 5, 6, 7, 8)) } },
    tilemaps: { m: { tileset: 't', width: 2, height: 1, palettes: ['p0'], layers: [{ entries: [0, 1 | 0x400] }] } },
    sprites: { s: { tileset: 't', palette: 'p0', frameWidth: 16, frameHeight: 8, mapping: '1d' } },
    animations: { a: { sprite: 's', sequences: [[{ frame: 0, duration: 2 }, { frame: 1, duration: 3 }, { jump: 0 }]] } },
  };
}

test('validatePack: válido, referencias rotas y licencia ausente', () => {
  const ok = validatePack(samplePack());
  assert.equal(ok.ok, true, ok.errors.join('\n')); assert.deepEqual(ok.warnings, []);
  const bad = samplePack();
  bad.sprites.s.tileset = 'nope'; bad.animations.a.sequences[0][2] = { jump: 9 }; bad.tilemaps.m.layers[0].entries.pop(); delete bad.meta.license;
  bad.palettes.p0.colors[3] = 'red';
  const r = validatePack(bad);
  assert.equal(r.ok, false);
  for (const re of [/sprites\.s\.tileset/, /jump fuera/, /se esperan 2 entradas/, /no es #rrggbb/]) assert.ok(r.errors.some((e) => re.test(e)), re);
  assert.ok(r.warnings.some((w) => /licencia/.test(w)));
  assert.equal(validatePack(null).ok, false);
});

test('PaletteManager: bancos, fundido y versión', () => {
  const pm = new PaletteManager(); pm.register('a', pal16(0x808080));
  const v0 = pm.version;
  pm.fade(1, 0xff000000); assert.ok(pm.get('a').every((c) => c === 0xff000000)); assert.ok(pm.version > v0);
  pm.reset(); assert.equal(pm.get('a')[0], hexToRGBA('#808080'));
  const banks = pm.banks([null, 'a']); assert.equal(banks.length, 32); assert.equal(banks[0], 0); assert.equal(banks[16], hexToRGBA('#808080'));
  assert.throws(() => pm.get('x'), /no registrada/);
});

test('TileManager y TilemapManager: composición, volteo, transparencia y caché por paleta', () => {
  const pm = new PaletteManager(); pm.register('p', pal16(0x101010));
  const tm = new TileManager(); const tiles = solidTiles(0, 2); tiles[32] = 0x20; // tile 1: píxel (0,0)=0, (1,0)=2
  tm.register('t', tiles);
  assert.equal(tm.get('t').count, 2); assert.throws(() => tm.tile('t', 5), RangeError);
  const maps = new TilemapManager(tm, pm);
  maps.register('m', { tileset: 't', width: 2, height: 1, palettes: ['p'], layers: [{ entries: [1, 1 | 0x400] }] });
  const r = maps.layerRGBA('m'); const u = new Uint32Array(r.data.buffer);
  assert.equal(u[0], 0);                                   // índice 0 → transparente
  assert.equal(u[1], pm.get('p')[2]);
  assert.equal(u[8 + 7], 0); assert.equal(u[8 + 6], pm.get('p')[2]); // volteado horizontal
  assert.equal(maps.layerRGBA('m'), r);                    // caché
  pm.fade(0.5); assert.notEqual(maps.layerRGBA('m'), r);   // invalidación por versión
  maps.register('bad', { tileset: 't', width: 1, height: 1, palettes: ['p'], layers: [{ entries: [9] }] });
  assert.match(maps.errors[0], /Tile 9 fuera/);
});

/** Ejecuta un reproductor y devuelve el frame mostrado en cada tick (incluido el tick 0). */
const trace = (seq, ticks) => { const p = new AnimationPlayer([seq]); const out = [p.image]; for (let i = 0; i < ticks; i++) { p.tick(); out.push(p.image); } return { out, p }; };

test('AnimationPlayer: duraciones idénticas a src/sprite.c (max(d,1) ticks) y END', () => {
  // sAnim_Pikachu_1 de la descompilación
  const { out, p } = trace([{ frame: 0, duration: 15 }, { frame: 1, duration: 20 }, { frame: 0, duration: 15 }, { frame: 1, duration: 20 }, { frame: 0, duration: 15 }, { end: true }], 100);
  const runs = []; out.forEach((f, i) => (i && out[i - 1] === f ? runs[runs.length - 1][1]++ : runs.push([f, 1])));
  assert.deepEqual(runs.slice(0, 4), [[0, 15], [1, 20], [0, 15], [1, 20]]);
  assert.equal(p.ended, true); assert.equal(out.at(-1), 0);
  // duración 0 → 1 tick
  assert.deepEqual(trace([{ frame: 4, duration: 0 }, { frame: 5, duration: 0 }, { end: true }], 3).out, [4, 5, 5, 5]);
});

test('AnimationPlayer: JUMP aplica el frame destino en el mismo tick', () => {
  const { out } = trace([{ frame: 0, duration: 2 }, { frame: 1, duration: 1 }, { jump: 0 }], 8);
  assert.deepEqual(out, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test('AnimationPlayer: LOOP(n) repite el bloque n veces y continúa', () => {
  // A(1) B(1) LOOP(2) C(1) END → el bloque A B se ejecuta 3 veces (n+1), como en src/sprite.c
  const { out, p } = trace([{ frame: 0, duration: 1 }, { frame: 1, duration: 1 }, { loop: 2 }, { frame: 2, duration: 1 }, { end: true }], 10);
  assert.deepEqual(out.slice(0, 8), [0, 1, 0, 1, 0, 1, 2, 2]);
  assert.equal(p.ended, true);
  assert.throws(() => trace([{ loop: 1 }, { loop: 1 }], 3), /Bucle de animación/);
});

test('SpriteManager + AnimationManager: fotogramas 1D, volteo y sincronización', () => {
  const pm = new PaletteManager(); pm.register('p', pal16(0x202020));
  const tm = new TileManager(); tm.register('t', solidTiles(1, 2, 3, 4));
  const am = new AnimationManager(); am.register('a', { sprite: 's', sequences: [[{ frame: 1, duration: 1, hflip: true }, { jump: 0 }]] });
  const sm = new SpriteManager(tm, pm, am); sm.register('s', { tileset: 't', palette: 'p', frameWidth: 16, frameHeight: 8 });
  assert.equal(sm.def('s').frameCount, 2);
  const f1 = new Uint32Array(sm.frameRGBA('s', 1).data.buffer);
  assert.equal(f1[0], pm.get('p')[3]); assert.equal(f1[8], pm.get('p')[4]);
  assert.throws(() => sm.frameRGBA('s', 2), RangeError);
  const inst = sm.spawn('s', { animation: 'a' }); am.tick(); sm.sync();
  assert.equal(inst.frame, 1); assert.equal(inst.hflip, true);
  sm.remove(inst); assert.equal(am.players.size, 0);
});

test('Engine.loadPack: registro completo y rechazo de packs inválidos', () => {
  const e = new Engine(); const v = e.loadPack(samplePack());
  assert.equal(v.ok, true);
  const s = e.sprites.spawn('s', { animation: 'a' });
  for (let i = 0; i < 3; i++) e.step();
  assert.equal(e.ticks, 3); assert.equal(s.frame, 1);
  const bad = samplePack(); bad.version = 2;
  assert.throws(() => new Engine().loadPack(bad), /Pack inválido/);
});

import { spriteToPack, mapToPack, rgbaToHex } from '../src/export/toPack.js';
import { validatePack as vp } from '../src/engine/AssetPack.js';
import { buildDemoPack } from '../src/demo/demoPack.js';

test('exportación a pack: sprite con animación y mapa aplanado, ambos válidos', () => {
  const palc = new Uint32Array(16).map((_, i) => 0xff000000 | (i * 0x101010));
  assert.equal(rgbaToHex(0xff0a0b0c), '#0c0b0a');
  const sp = spriteToPack({ tiles: solidTiles(1, 2, 3, 4), palette: palc, frameWidth: 16, frameHeight: 8, sequences: [[{ op: 'frame', image: 1, duration: 3, hflip: false, vflip: false }, { op: 'end' }]], meta: { source: 'test' } });
  const v = vp(sp); assert.equal(v.ok, true, v.errors.join()); assert.ok(v.warnings.some((w) => /licencia/.test(w)));
  assert.deepEqual(sp.animations.sprite.sequences[0], [{ frame: 1, duration: 3 }, { end: true }]);
  const mt = new Uint8Array(32); for (let k = 0; k < 8; k++) { mt[16 + k * 2] = k; } // metatile 1 = tiles 0..7
  const pair = { primary: { tiles: solidTiles(1, 2), metatiles: mt }, secondary: { tiles: solidTiles(3), metatiles: new Uint8Array(0) }, palette: new Uint32Array(256) };
  const { pack, missingMetatiles } = mapToPack({ mapBytes: Uint8Array.from([1, 0, 0, 2]), width: 2, height: 1, pair });
  assert.equal(vp(pack).ok, true, vp(pack).errors.join());
  assert.deepEqual(pack.tilemaps.map.layers[0].entries, [0, 1, 0, 0, 2, 3, 0, 0]);
  assert.deepEqual(pack.tilemaps.map.layers[1].entries.slice(0, 2), [4, 5]);
  assert.deepEqual(missingMetatiles, [512]);
});

test('pack de demostración: válido, con licencia y cargable en el motor', () => {
  const p = buildDemoPack(); const v = vp(p);
  assert.equal(v.ok, true, v.errors.join()); assert.deepEqual(v.warnings, []);
  const e = new Engine(); e.loadPack(p);
  assert.deepEqual(e.tilemaps.size('field'), { width: 320, height: 240, layers: 2 });
  assert.equal(e.sprites.def('hero').frameCount, 6);
  assert.equal(e.tilemaps.errors.length, 0);
});
