/**
 * Engine — integra los cinco gestores, carga packs "gba-asset-pack" y dibuja en un <canvas>.
 * Bucle de tiempo fijo a 60 Hz (como el VBlank del GBA): la lógica avanza en ticks enteros y el dibujo
 * ocurre una vez por requestAnimationFrame. La parte que toca el DOM está aislada en draw()/run().
 */
import { PaletteManager } from './PaletteManager.js';
import { TileManager } from './TileManager.js';
import { TilemapManager } from './TilemapManager.js';
import { AnimationManager } from './AnimationManager.js';
import { SpriteManager } from './SpriteManager.js';
import { validatePack, base64Decode } from './AssetPack.js';

export const TICK_MS = 1000 / 60;

export class Engine {
  constructor({ width = 240, height = 160, backdrop = '#000000' } = {}) {
    this.width = width; this.height = height; this.backdrop = backdrop;
    this.palettes = new PaletteManager();
    this.tiles = new TileManager();
    this.tilemaps = new TilemapManager(this.tiles, this.palettes);
    this.animations = new AnimationManager();
    this.sprites = new SpriteManager(this.tiles, this.palettes, this.animations);
    this.background = []; // [{ tilemap, layer, scrollX, scrollY, priority }]
    this.camera = { x: 0, y: 0 };
    this.ticks = 0; this.onTick = null; this.log = [];
    this._bitmaps = new Map();
  }

  /** Valida y registra un pack. Lanza si hay errores; las advertencias van a `log`. */
  loadPack(pack) {
    const v = validatePack(pack);
    v.warnings.forEach((w) => this.log.push({ level: 'warn', message: w }));
    if (!v.ok) { v.errors.forEach((e) => this.log.push({ level: 'error', message: e })); throw new Error(`Pack inválido:\n${v.errors.join('\n')}`); }
    for (const [id, p] of Object.entries(pack.palettes ?? {})) this.palettes.register(id, p.colors);
    for (const [id, t] of Object.entries(pack.tilesets ?? {})) this.tiles.register(id, base64Decode(t.data), t.bpp);
    for (const [id, m] of Object.entries(pack.tilemaps ?? {})) this.tilemaps.register(id, m);
    for (const [id, s] of Object.entries(pack.sprites ?? {})) this.sprites.register(id, s);
    for (const [id, a] of Object.entries(pack.animations ?? {})) this.animations.register(id, a);
    this.tilemaps.errors.forEach((e) => this.log.push({ level: 'error', message: e }));
    return v;
  }

  addBackground(tilemap, { layer = 0, priority = 0, parallax = 1 } = {}) {
    this.background.push({ tilemap, layer, priority, parallax });
    this.background.sort((a, b) => a.priority - b.priority);
  }

  /** Un tick de lógica (1/60 s). */
  step() {
    this.ticks++;
    this.onTick?.(this);
    this.animations.tick();
    this.sprites.sync();
  }

  // ------------------------------------------------------------ DOM / Canvas
  #bitmap(key, rgba) {
    let b = this._bitmaps.get(key);
    if (!b || b.rgba !== rgba) {
      const c = b?.canvas ?? document.createElement('canvas');
      c.width = rgba.width; c.height = rgba.height;
      c.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
      b = { canvas: c, rgba }; this._bitmaps.set(key, b);
    }
    return b.canvas;
  }

  /** Dibuja el estado actual en un contexto 2D de tamaño width×height (escalar con CSS). */
  draw(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.backdrop; ctx.fillRect(0, 0, this.width, this.height);
    const cx = Math.round(this.camera.x), cy = Math.round(this.camera.y);
    for (const bg of this.background) {
      ctx.drawImage(this.#bitmap(`bg:${bg.tilemap}:${bg.layer}`, this.tilemaps.layerRGBA(bg.tilemap, bg.layer)), -Math.round(cx * bg.parallax), -Math.round(cy * bg.parallax));
    }
    for (const s of this.sprites.drawList()) {
      const img = this.#bitmap(`sp:${s.sprite}:${s.frame}`, this.sprites.frameRGBA(s.sprite, s.frame));
      const x = Math.round(s.x - cx), y = Math.round(s.y - cy);
      if (s.hflip || s.vflip) {
        ctx.save(); ctx.translate(x + (s.hflip ? img.width : 0), y + (s.vflip ? img.height : 0)); ctx.scale(s.hflip ? -1 : 1, s.vflip ? -1 : 1); ctx.drawImage(img, 0, 0); ctx.restore();
      } else ctx.drawImage(img, x, y);
    }
  }

  /** Arranca el bucle en un canvas. Devuelve una función para detenerlo. */
  run(canvas) {
    canvas.width = this.width; canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    let last = performance.now(), acc = 0, raf = 0, running = true;
    const frame = (now) => {
      if (!running) return;
      acc = Math.min(acc + (now - last), 250); last = now; // evita la "espiral" tras pestaña en segundo plano
      while (acc >= TICK_MS) { this.step(); acc -= TICK_MS; }
      this.draw(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { running = false; cancelAnimationFrame(raf); };
  }
}
