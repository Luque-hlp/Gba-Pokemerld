/**
 * Controles: teclado (configurable, guardado en localStorage) y botones táctiles/ratón en pantalla.
 */
import { KEYS } from '../hardware/keypad.js';

export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'L', 'R', 'START', 'SELECT'];
export const BUTTON_LABELS = { UP: 'Arriba', DOWN: 'Abajo', LEFT: 'Izquierda', RIGHT: 'Derecha', A: 'A', B: 'B', L: 'L', R: 'R', START: 'Start', SELECT: 'Select' };
export const DEFAULT_MAP = { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', A: 'KeyX', B: 'KeyZ', L: 'KeyA', R: 'KeyS', START: 'Enter', SELECT: 'Backspace' };
const STORAGE_KEY = 'gba-emulator-keymap';

export function loadKeymap() {
  try { const m = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (m && BUTTONS.every((b) => typeof m[b] === 'string')) return m; } catch { /* sin acceso */ }
  return { ...DEFAULT_MAP };
}
export function saveKeymap(map) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* sin acceso */ } }

export class Controls {
  /** @param {import('../hardware/keypad.js').Keypad} keypad */
  constructor(keypad) {
    this.keypad = keypad; this.map = loadKeymap(); this.enabled = true; this.capture = null;
    this.held = new Set();
    addEventListener('keydown', (e) => this.#key(e, true));
    addEventListener('keyup', (e) => this.#key(e, false));
    addEventListener('blur', () => this.releaseAll());
  }
  #key(e, down) {
    if (this.capture && down) { e.preventDefault(); this.capture(e.code); this.capture = null; return; }
    if (!this.enabled || e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
    const btn = BUTTONS.find((b) => this.map[b] === e.code);
    if (!btn) return;
    e.preventDefault();
    this.press(btn, down);
  }
  press(btn, down) {
    if (down) this.held.add(btn); else this.held.delete(btn);
    this.keypad.set(KEYS[btn], down);
  }
  releaseAll() { for (const b of [...this.held]) this.press(b, false); }
  /** Espera la próxima tecla para asignarla al botón indicado. */
  remap(btn) {
    return new Promise((resolve) => { this.capture = (code) => { this.map[btn] = code; saveKeymap(this.map); resolve(code); }; });
  }
  resetMap() { this.map = { ...DEFAULT_MAP }; saveKeymap(this.map); }

  /** Conecta los botones en pantalla (elementos con data-btn). Admite multitáctil y arrastrar entre botones. */
  bindTouch(root) {
    const active = new Map(); // pointerId → botón
    const btnAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-btn]')?.dataset.btn ?? null;
    const set = (id, btn) => {
      const prev = active.get(id);
      if (prev === btn) return;
      if (prev) { this.press(prev, false); root.querySelector(`[data-btn="${prev}"]`)?.classList.remove('down'); }
      if (btn) { this.press(btn, true); root.querySelector(`[data-btn="${btn}"]`)?.classList.add('down'); active.set(id, btn); } else active.delete(id);
    };
    root.addEventListener('pointerdown', (e) => { const b = btnAt(e.clientX, e.clientY); if (!b) return; e.preventDefault(); root.setPointerCapture?.(e.pointerId); set(e.pointerId, b); });
    root.addEventListener('pointermove', (e) => { if (active.has(e.pointerId)) set(e.pointerId, btnAt(e.clientX, e.clientY)); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(ev, (e) => set(e.pointerId, null));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
