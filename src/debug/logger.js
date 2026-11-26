/** Registro de eventos del emulador (cargador, CPU, BIOS, E/S) con límite de tamaño y contadores. */
export class Logger {
  constructor(limit = 500) { this.entries = []; this.limit = limit; this.counts = new Map(); this.listeners = new Set(); }
  log(level, message) {
    const key = `${level}|${message}`;
    const n = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, n);
    if (n > 3) return; // los mensajes repetidos solo se cuentan
    const e = { time: new Date().toISOString().slice(11, 19), level, message };
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.shift();
    for (const l of this.listeners) l(e);
  }
  clear() { this.entries = []; this.counts.clear(); }
}
