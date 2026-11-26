# Emulador de Game Boy Advance en JavaScript nativo

Proyecto universitario de investigación: un emulador del hardware de la GBA escrito **desde cero**
en JavaScript (ES2020+), HTML5 Canvas y Web Audio, **sin bibliotecas, sin WebAssembly y sin código
de otros emuladores**. El objetivo de compatibilidad es Pokémon Esmeralda.

> **ROM y BIOS.** El proyecto no incluye ninguna ROM ni la BIOS de Nintendo. Cada persona selecciona
> una copia que tenga derecho a usar; el archivo se lee en su navegador con la File API y nunca se
> envía a ningún servidor. La BIOS se sustituye por una capa de emulación de alto nivel propia
> (`src/bios/hle.js`).

## Cómo usarlo
| Forma | Comando | Notas |
|---|---|---|
| Archivo único | abrir `dist/index.html` con doble clic | Funciona sin servidor (`node tools/build.mjs` lo regenera) |
| Servidor local | `npm run serve` → http://localhost:8080 | Usa los módulos de `src/` directamente |
| Docker | `docker build -t gba-emulator .` y `docker run --rm -p 8080:80 gba-emulator` | nginx sirve la aplicación; bloquea rutas `.gba/.sav` |

Controles por defecto: cruceta = flechas · A = X · B = Z · L = A · R = S · Start = Intro · Select = Retroceso.
Se pueden cambiar en «Controles». En pantallas táctiles y con el ratón hay botones en pantalla.
El panel «Desarrollador» (F2) muestra la CPU, los registros de vídeo, IRQ, DMA, timers, llamadas a la BIOS,
la memoria y un registro de instrucciones.

**Guardado:** el juego guarda en la Flash emulada del cartucho y el navegador la conserva en IndexedDB
(se recupera al volver a abrir la página). Se puede exportar o importar como `.sav`. Los «estados
rápidos» son instantáneas del emulador y van aparte del guardado del juego.

## Arquitectura
```
src/emulator.js        fotograma = 228 líneas × 1232 ciclos; CPU en porciones cortadas por los timers
src/cpu/               ARM7TDMI: arm7tdmi.js (registros con bancos, modos, excepciones), arm.js, thumb.js
src/memory/            bus.js (mapa de memoria, espejos, accesos 8/16/32, open bus), io.js (registros de E/S)
src/video/             ppu.js (temporización), background.js, sprites.js, renderer.js (ventanas y mezcla), palette.js
src/audio/             apu.js (registros y FIFO), sound.js (PSG 1–4 + Direct Sound), webAudio.js (salida)
src/hardware/          interrupts.js, timers.js, dma.js, keypad.js, serial.js
src/cartridge/         romLoader.js (validación), saveMemory.js (Flash/SRAM), gpio.js (RTC Seiko S-3511)
src/bios/hle.js        vector de IRQ propio + implementación de las SWI
src/storage/           saveManager.js (IndexedDB, .sav), saveState.js (estados rápidos)
src/debug/, src/ui/    panel de desarrollador, registro, interfaz y controles
tools/                 build.mjs (archivo único), serve.mjs (servidor de desarrollo), headless.mjs (pruebas con ROM local)
tests/                 node --test: CPU (ARM/Thumb), memoria, timers, DMA, BIOS, Flash, RTC, serie, PPU, estados
```
Detalles de diseño y fases: [docs/PLAN.md](docs/PLAN.md). Estado verificado con el juego real:
[docs/COMPATIBILIDAD.md](docs/COMPATIBILIDAD.md).

## Pruebas
```bash
npm test                                   # 43 pruebas con programas y datos sintéticos (sin ROM)
node tools/headless.mjs <tu-rom.gba> --frames 2000 --shots 500,2000 --keys START@1700:5 --out capturas/
```
Fuentes técnicas consultadas: GBATEK (Martin Korth), manual de arquitectura ARM7TDMI, y la
descompilación comunitaria `pret/pokeemerald` (solo para entender qué espera el juego del hardware:
llamadas a la BIOS, chips de guardado y protocolo del RTC; no se copia código de ella).
