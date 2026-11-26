/**
 * Pack de demostración generado por código: arte ORIGINAL (formas geométricas simples), licencia CC0.
 * No contiene ni deriva de ningún recurso de terceros. Sirve para probar el motor sin ROM.
 */
import { base64Encode } from '../engine/AssetPack.js';

/** Lienzo de índices de w×h px → datos 4bpp GBA en orden de tiles 1D (fila de tiles a fila de tiles). */
class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.p = new Uint8Array(w * h); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.3) this.set(cx + x, cy + y, c); }
  to4bpp() {
    const out = new Uint8Array((this.w * this.h) / 2); let o = 0;
    for (let ty = 0; ty < this.h; ty += 8) for (let tx = 0; tx < this.w; tx += 8)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2) out[o++] = this.p[(ty + y) * this.w + tx + x] | (this.p[(ty + y) * this.w + tx + x + 1] << 4);
    return out;
  }
}

/** PRNG determinista para que el pack sea reproducible. */
function rng(seed) { return () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296); }

export function buildDemoPack() {
  const r = rng(7);
  // ---- tiles de fondo: 16 tiles de 8×8 en una tira de 128×8
  // 0 vacío · 1–3 hierba · 4 camino · 5–6 borde camino · 7 agua · 8 flor · 9 piedra · 10–13 árbol (2×2)
  const bg = new Pix(14 * 8, 8);
  const T = (n, fn) => fn(n * 8);
  for (let n = 1; n <= 3; n++) T(n, (ox) => { bg.rect(ox, 0, 8, 8, 1); for (let k = 0; k < 5 + n; k++) bg.set(ox + ((r() * 8) | 0), (r() * 8) | 0, 2 + (k % 2)); });
  T(4, (ox) => { bg.rect(ox, 0, 8, 8, 4); for (let k = 0; k < 4; k++) bg.set(ox + ((r() * 8) | 0), (r() * 8) | 0, 5); });
  T(5, (ox) => { bg.rect(ox, 0, 8, 8, 4); bg.rect(ox, 0, 8, 2, 1); bg.rect(ox, 2, 8, 1, 3); });
  T(6, (ox) => { bg.rect(ox, 0, 8, 8, 4); bg.rect(ox, 6, 8, 2, 1); bg.rect(ox, 5, 8, 1, 3); });
  T(7, (ox) => { bg.rect(ox, 0, 8, 8, 12); for (let y = 0; y < 8; y += 4) for (let x = 0; x < 8; x++) bg.set(ox + x, y + ((x >> 1) % 2), 13 + ((x + y) % 3)); });
  T(8, (ox) => { bg.rect(ox, 0, 8, 8, 1); bg.disc(ox + 3, 3, 1, 6); bg.set(ox + 3, 3, 7); bg.set(ox + 3, 6, 2); });
  T(9, (ox) => { bg.rect(ox, 0, 8, 8, 1); bg.disc(ox + 4, 4, 2, 8); bg.set(ox + 3, 3, 9); });
  // árbol 16×16 → tiles 10..13 (arriba-izq, arriba-der, abajo-izq, abajo-der)
  const tree = new Pix(16, 16); tree.rect(0, 0, 16, 16, 1); tree.disc(8, 6, 6, 10); tree.disc(6, 4, 2, 11); tree.rect(7, 12, 2, 4, 9);
  [[0, 0], [8, 0], [0, 8], [8, 8]].forEach(([sx, sy], k) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bg.set((10 + k) * 8 + x, y, tree.p[(sy + y) * 16 + sx + x]); });

  // ---- mapa 40×30 tiles: hierba aleatoria, camino en cruz, estanque, árboles y flores
  const W = 40, H = 30, ground = new Array(W * H).fill(0), top = new Array(W * H).fill(0);
  for (let i = 0; i < W * H; i++) ground[i] = 1 + ((r() * 3) | 0);
  const put = (x, y, t, layer = ground) => { if (x >= 0 && y >= 0 && x < W && y < H) layer[y * W + x] = t; };
  for (let x = 0; x < W; x++) { put(x, 13, 5); put(x, 14, 4); put(x, 15, 4); put(x, 16, 6); }
  for (let y = 0; y < H; y++) { put(19, y, 4); put(20, y, 4); }
  for (let y = 3; y < 10; y++) for (let x = 26; x < 36; x++) put(x, y, 7);
  for (let k = 0; k < 40; k++) put((r() * W) | 0, (r() * 12) | 0, r() < 0.6 ? 8 : 9);
  const treeAt = (x, y) => { put(x, y, 10, top); put(x + 1, y, 11, top); put(x, y + 1, 12, top); put(x + 1, y + 1, 13, top); };
  for (let x = 0; x < W; x += 2) { treeAt(x, 0); treeAt(x, H - 2); }
  for (let y = 2; y < H - 2; y += 2) { treeAt(0, y); treeAt(W - 2, y); }
  for (let k = 0; k < 10; k++) treeAt(4 + ((r() * 12) | 0) * 1, 19 + ((r() * 4) | 0) * 2);

  // ---- personaje original 16×16: "farolillo" con ojos, 3 fotogramas (quieto, paso A, paso B) × 2 vistas
  const hero = new Pix(16, 16 * 6);
  const drawHero = (f, view, step) => {
    const oy = f * 16, bob = step ? 1 : 0;
    hero.disc(8, oy + 8 + bob, 5, 1); hero.disc(8, oy + 7 + bob, 3, 2);          // cuerpo
    hero.rect(5, oy + 1 + bob, 6, 2, 3); hero.rect(7, oy + bob, 2, 1, 3);         // asa
    if (view === 0) { hero.set(6, oy + 8 + bob, 4); hero.set(10, oy + 8 + bob, 4); } // de frente: dos ojos
    else hero.set(11, oy + 8 + bob, 4);                                              // de lado: un ojo
    const lx = step === 1 ? 4 : 5, rx = step === 2 ? 11 : 10;
    hero.rect(lx, oy + 13 + bob, 2, 2, 5); hero.rect(rx, oy + 13 + bob, 2, 2, 5);  // patas
  };
  [0, 1, 2].forEach((s) => drawHero(s, 0, s)); [0, 1, 2].forEach((s) => drawHero(3 + s, 1, s));
  // 16×16 en 1D = 4 tiles por fotograma en orden fila a fila: reordenar desde la tira vertical
  const heroTiles = new Pix(32 * 6, 8); // 6 fotogramas × 4 tiles, en una fila de tiles
  for (let f = 0; f < 6; f++) [[0, 0], [8, 0], [0, 8], [8, 8]].forEach(([sx, sy], k) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) heroTiles.set((f * 4 + k) * 8 + x, y, hero.p[(f * 16 + sy + y) * 16 + sx + x]);
  });

  const pal = (cs) => ({ colors: [...cs, ...Array(16 - cs.length).fill('#000000')] });
  const walk = (base, hflip = false) => [{ frame: base + 1, duration: 8, hflip }, { frame: base, duration: 8, hflip }, { frame: base + 2, duration: 8, hflip }, { frame: base, duration: 8, hflip }, { jump: 0 }];
  return {
    format: 'gba-asset-pack', version: 1,
    meta: { name: 'Demo original', license: 'CC0-1.0', source: 'Generado por src/demo/demoPack.js' },
    palettes: {
      field: pal(['#000000', '#5aa95a', '#4b9150', '#78c06c', '#d8c08a', '#c4a870', '#f07c8c', '#fff2a0', '#8f969c', '#c2c8cc', '#2f7d46', '#4ea862', '#3d7fd0', '#5d9ae0', '#8ab9ef', '#c8e2ff']),
      hero: pal(['#000000', '#e8a33c', '#fff1b8', '#6b4a2b', '#1d1d2b', '#6b4a2b']),
    },
    tilesets: { field: { bpp: 4, data: base64Encode(bg.to4bpp()) }, hero: { bpp: 4, data: base64Encode(heroTiles.to4bpp()) } },
    tilemaps: { field: { tileset: 'field', width: W, height: H, palettes: ['field'], layers: [{ entries: ground }, { entries: top }] } },
    sprites: { hero: { tileset: 'hero', palette: 'hero', frameWidth: 16, frameHeight: 16, mapping: '1d' } },
    animations: {
      hero: { sprite: 'hero', sequences: [
        [{ frame: 0, duration: 0 }, { end: true }],            // 0 quieto de frente
        walk(0),                                               // 1 andar de frente
        [{ frame: 3, duration: 0 }, { end: true }],            // 2 quieto de lado
        walk(3),                                               // 3 andar a la derecha
        [{ frame: 3, duration: 0, hflip: true }, { end: true }], // 4 quieto mirando a la izquierda
        walk(3, true),                                         // 5 andar a la izquierda (volteo del frame)
      ] },
    },
  };
}
