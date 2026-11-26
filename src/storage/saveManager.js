/**
 * Persistencia local (IndexedDB, sin servidores).
 *  - "saves": memoria de guardado del cartucho (lo que el juego escribe al guardar). Clave por juego + CRC32.
 *  - "states": estados rápidos del emulador (instantáneas completas), separados del guardado del juego.
 * La ROM nunca se almacena.
 */
const DB_NAME = 'gba-emulator', DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export class SaveManager {
  /** @param {string} key identificador del juego (código + CRC32 de la ROM) */
  constructor(key, saveMemory, { onStatus } = {}) {
    this.key = key; this.mem = saveMemory; this.onStatus = onStatus ?? (() => {});
    this.timer = null; this.lastWrite = 0;
  }
  async load() {
    if (!this.mem) return false;
    const rec = await tx('saves', 'readonly', (s) => s.get(this.key));
    if (rec?.data && rec.data.length === this.mem.data.length && rec.type === this.mem.type) {
      this.mem.data.set(rec.data); this.mem.dirty = false;
      this.onStatus(`Partida guardada recuperada (${new Date(rec.updated).toLocaleString()})`);
      return true;
    }
    return false;
  }
  async persist() {
    if (!this.mem) return;
    this.mem.dirty = false;
    await tx('saves', 'readwrite', (s) => s.put({ type: this.mem.type, data: this.mem.data.slice(), updated: Date.now() }, this.key));
    this.onStatus('Partida guardada en el navegador');
  }
  /** Comprobar periódicamente: guarda cuando el juego deja de escribir durante 500 ms. */
  tick() {
    if (!this.mem?.dirty) return;
    const now = performance.now();
    if (!this.lastWrite) this.lastWrite = now;
    if (now - this.lastWrite > 500) { this.lastWrite = 0; this.persist(); }
  }
  /** Archivo .sav compatible (volcado en bruto de la memoria de guardado). */
  exportBlob() { return new Blob([this.mem.data], { type: 'application/octet-stream' }); }
  async import(bytes) {
    if (!this.mem) throw new Error('Este juego no usa memoria de guardado.');
    if (bytes.length !== this.mem.data.length) throw new Error(`Tamaño incompatible: el archivo mide ${bytes.length} bytes y la memoria de este juego ${this.mem.data.length}.`);
    this.mem.data.set(bytes);
    await this.persist();
  }
  async saveState(slot, state) { await tx('states', 'readwrite', (s) => s.put({ state, updated: Date.now() }, `${this.key}#${slot}`)); }
  async loadState(slot) { return (await tx('states', 'readonly', (s) => s.get(`${this.key}#${slot}`)))?.state ?? null; }
}
