/**
 * AnimationManager — reproduce secuencias con la MISMA semántica que el motor de sprites de
 * pokeemerald (src/sprite.c: BeginAnim, ContinueAnim, AnimCmd_frame/end/jump/loop, JumpToTopOfAnimLoop).
 * Paso de tiempo: 1 tick = 1 fotograma de 60 Hz. Comandos:
 *   {frame, duration, hflip?, vflip?} | {end:true} | {jump:target} | {loop:count}
 * Comportamiento reproducido:
 *   - un frame de duración d se muestra max(d,1) ticks;
 *   - END detiene la animación en el último frame (animEnded);
 *   - JUMP salta al índice destino y aplica ese frame en el mismo tick;
 *   - LOOP(n) vuelve al inicio del bloque (tras el LOOP anterior o desde el principio) n veces:
 *     el bloque se ejecuta n+1 veces en total (comportamiento real de JumpToTopOfAnimLoop).
 */
const typeOf = (c) => (c === undefined ? undefined : 'frame' in c ? 'frame' : 'end' in c ? 'end' : 'jump' in c ? 'jump' : 'loop');

export class AnimationPlayer {
  /** @param {Array<Array<object>>} sequences */
  constructor(sequences) { this.sequences = sequences; this.start(0); }

  start(animNum) {
    this.animNum = animNum; this.cmdIndex = 0; this.ended = false; this.loopCounter = 0; this.paused = false;
    this.delay = 0;
    const c = this.#cmd();
    if (typeOf(c) !== 'end') this.#applyFrame(c); // BeginAnim: imageValue != -1
  }
  #seq() { return this.sequences[this.animNum]; }
  #cmd(i = this.cmdIndex) { return this.#seq()[i] ?? { end: true }; } // fin implícito si falta END
  #applyFrame(c) {
    if (typeOf(c) !== 'frame') return; // datos mal formados: se ignora (el juego leería basura)
    this.delay = c.duration ? c.duration - 1 : 0;
    this.image = c.frame; this.hflip = !!c.hflip; this.vflip = !!c.vflip;
  }
  /** Avanza un tick (ContinueAnim). */
  tick(depth = 0) {
    if (depth > 64) throw new Error('Bucle de animación sin frames (LOOP/JUMP anidados sin avanzar)');
    if (this.delay) { this.delay--; return; }
    if (this.paused) return;
    this.cmdIndex++;
    this.#dispatch(depth);
  }
  #dispatch(depth) {
    const c = this.#cmd();
    switch (typeOf(c)) {
      case 'frame': this.#applyFrame(c); break;
      case 'end': this.cmdIndex--; this.ended = true; break;
      case 'jump': this.cmdIndex = c.jump; this.#applyFrame(this.#cmd()); break;
      case 'loop':
        if (this.loopCounter) this.loopCounter--; else this.loopCounter = c.loop;
        this.#jumpToTopOfLoop();
        this.tick(depth + 1);
        break;
    }
  }
  #jumpToTopOfLoop() {
    if (!this.loopCounter) return;
    this.cmdIndex--;
    while (typeOf(this.#seq()[this.cmdIndex - 1]) !== 'loop') { if (this.cmdIndex === 0) break; this.cmdIndex--; }
    this.cmdIndex--;
  }
}

export class AnimationManager {
  constructor() { this.defs = new Map(); this.players = new Set(); }
  register(id, def) { this.defs.set(id, def); }
  get(id) { const d = this.defs.get(id); if (!d) throw new Error(`Animación "${id}" no registrada`); return d; }
  /** Crea un reproductor; si se pasa `onFrame`, se llama tras cada tick con el estado. */
  create(id, animNum = 0) { const p = new AnimationPlayer(this.get(id).sequences); p.start(animNum); this.players.add(p); return p; }
  destroy(p) { this.players.delete(p); }
  tick() { for (const p of this.players) p.tick(); }
}
