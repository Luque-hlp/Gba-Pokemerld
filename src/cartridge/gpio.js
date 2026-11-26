/**
 * Puerto GPIO del cartucho (0x080000C4 datos, C6 dirección, C8 habilitación de lectura) con el
 * reloj Seiko S-3511 conectado: bit 0 SCK, bit 1 SIO, bit 2 CS.
 * Protocolo (tal como lo usa el juego, siirtc.c de la descompilación): con CS alto, cada bit se toma
 * en el flanco de subida de SCK; el comando va con el bit más significativo primero y los datos con
 * el menos significativo primero. Comando = 0x60 | n << 1 | lectura (n: 0 reset, 1 estado,
 * 2 fecha y hora [7 bytes BCD], 3 hora [3 bytes], 4 alarma [2 bytes]).
 * La hora es la del equipo más un desfase que el juego puede ajustar escribiendo.
 */
const LEN = [0, 1, 7, 3, 2, 0, 0, 0];
const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xff;
const unbcd = (b) => (b >> 4) * 10 + (b & 15);

export class RTC {
  constructor(now = () => Date.now()) {
    this.now = now; this.offsetMs = 0; this.status = 0x40; // 24 h, sin fallo de alimentación
    this.reset();
  }
  reset() { this.bitCount = 0; this.byte = 0; this.cmd = -1; this.reading = false; this.buf = []; this.pos = 0; this.out = 1; }
  dateBytes() {
    const d = new Date(this.now() + this.offsetMs);
    return [bcd(d.getFullYear() % 100), bcd(d.getMonth() + 1), bcd(d.getDate()), bcd(d.getDay()), bcd(d.getHours()), bcd(d.getMinutes()), bcd(d.getSeconds())];
  }
  begin() { this.reset(); }
  /** Un flanco de subida de SCK con el bit de entrada `sio`. */
  clock(sio) {
    if (this.cmd < 0) {
      this.byte = (this.byte << 1) | sio; // comando: MSB primero
      if (++this.bitCount === 8) {
        const b = this.byte & 0xff;
        this.bitCount = 0; this.byte = 0;
        if ((b & 0xf0) !== 0x60) return;
        this.cmd = (b >> 1) & 7; this.reading = (b & 1) === 1;
        if (this.cmd === 0) { this.status = 0x40; this.offsetMs = 0; }
        if (this.reading) this.buf = this.cmd === 1 ? [this.status] : this.cmd === 2 ? this.dateBytes() : this.cmd === 3 ? this.dateBytes().slice(4) : [0, 0];
        this.pos = 0;
      }
      return;
    }
    if (this.reading) {
      const byte = this.buf[this.pos >> 3] ?? 0;
      this.out = (byte >> (this.pos & 7)) & 1; // datos: LSB primero
      this.pos++;
    } else {
      this.byte |= sio << this.bitCount;
      if (++this.bitCount === 8) { this.buf.push(this.byte); this.byte = 0; this.bitCount = 0; if (this.buf.length >= LEN[this.cmd]) this.#applyWrite(); }
    }
  }
  #applyWrite() {
    if (this.cmd === 1) this.status = this.buf[0] & 0x6a | 0x40;
    if (this.cmd === 2 && this.buf.length >= 7) {
      const b = this.buf;
      const target = new Date(2000 + unbcd(b[0]), unbcd(b[1]) - 1, unbcd(b[2]), unbcd(b[4] & 0x3f), unbcd(b[5]), unbcd(b[6] & 0x7f));
      this.offsetMs = target.getTime() - this.now();
    }
  }
}

export class GPIO {
  constructor(rtc) { this.rtc = rtc; this.data = 0; this.dir = 0; this.readable = false; this.prevSck = 0; this.prevCs = 0; }
  read(a) {
    switch (a & 0xe) {
      case 0x4: { // datos: los pines de salida devuelven lo escrito; SIO de entrada, el bit del RTC
        let v = this.data & this.dir;
        if (!(this.dir & 2)) v |= this.rtc.out << 1;
        return v & 0xf;
      }
      case 0x6: return this.dir;
      case 0x8: return this.readable ? 1 : 0;
      default: return 0;
    }
  }
  write(a, v) {
    switch (a & 0xe) {
      case 0x4: {
        this.data = (this.data & ~this.dir) | (v & this.dir & 0xf);
        const sck = this.data & 1, sio = (this.data >> 1) & 1, cs = (this.data >> 2) & 1;
        if (cs && !this.prevCs) this.rtc.begin();
        if (cs && sck && !this.prevSck) this.rtc.clock(sio);
        if (!cs) this.rtc.reset();
        this.prevSck = sck; this.prevCs = cs;
        return;
      }
      case 0x6: this.dir = v & 0xf; return;
      case 0x8: this.readable = (v & 1) === 1; return;
      default: return;
    }
  }
}
