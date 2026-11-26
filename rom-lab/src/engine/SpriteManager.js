/**
 * SpriteManager — definiciones de sprites (tileset + paleta + tamaño de fotograma, mapeo OBJ 1D) e
 * instancias en pantalla. Fotograma k = tiles [k·n, (k+1)·n) con n = (w/8)·(h/8), dispuestos fila a fila
 * (equivale a RequestSpriteFrameImageCopy con un array de imágenes en pokeemerald).
 * Los fotogramas se rasterizan a RGBA bajo demanda y se cachean por versión de paleta.
 */
import { blitTile } from '../decoders/tiles.js';
import { indexedToRGBA } from '../decoders/image.js';

export class SpriteManager {
  constructor(tiles, palettes, animations) {
    this.tiles = tiles; this.palettes = palettes; this.animations = animations;
    this.defs = new Map(); this.instances = []; this.cache = new Map(); this.cacheVersion = -1;
  }
  register(id, def) {
    const ts = this.tiles.get(def.tileset);
    const perFrame = (def.frameWidth / 8) * (def.frameHeight / 8);
    this.defs.set(id, { ...def, perFrame, frameCount: Math.floor(ts.count / perFrame) });
  }
  def(id) { const d = this.defs.get(id); if (!d) throw new Error(`Sprite "${id}" no registrado`); return d; }

  /** Fotograma como RGBA { width, height, data }. */
  frameRGBA(id, frame) {
    if (this.cacheVersion !== this.palettes.version) { this.cache.clear(); this.cacheVersion = this.palettes.version; }
    const key = `${id}:${frame}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const d = this.def(id);
    if (frame < 0 || frame >= d.frameCount) throw new RangeError(`Fotograma ${frame} fuera de "${id}" (${d.frameCount})`);
    const wt = d.frameWidth / 8;
    const img = { width: d.frameWidth, height: d.frameHeight, pixels: new Uint8Array(d.frameWidth * d.frameHeight) };
    for (let k = 0; k < d.perFrame; k++) blitTile(img, this.tiles.tile(d.tileset, frame * d.perFrame + k), (k % wt) * 8, Math.floor(k / wt) * 8);
    const rgba = indexedToRGBA(img, this.palettes.get(d.palette), { transparentZero: true });
    this.cache.set(key, rgba);
    return rgba;
  }

  /**
   * Crea una instancia. Si `animation` se indica, un AnimationPlayer controla frame y volteos.
   * @returns {{sprite:string,x:number,y:number,frame:number,hflip:boolean,vflip:boolean,priority:number,visible:boolean,anim?:object}}
   */
  spawn(sprite, { x = 0, y = 0, priority = 0, animation, animNum = 0 } = {}) {
    this.def(sprite);
    const inst = { sprite, x, y, frame: 0, hflip: false, vflip: false, priority, visible: true };
    if (animation) inst.anim = this.animations.create(animation, animNum);
    this.instances.push(inst);
    return inst;
  }
  remove(inst) { this.instances = this.instances.filter((i) => i !== inst); if (inst.anim) this.animations.destroy(inst.anim); }
  /** Sincroniza frame/volteos desde los reproductores (llamar tras AnimationManager.tick()). */
  sync() { for (const i of this.instances) if (i.anim) { i.frame = i.anim.image ?? 0; i.hflip = i.anim.hflip; i.vflip = i.anim.vflip; } }
  /** Instancias visibles, de menor a mayor prioridad de dibujo. */
  drawList() { return this.instances.filter((i) => i.visible).sort((a, b) => a.priority - b.priority || a.y - b.y); }
}
