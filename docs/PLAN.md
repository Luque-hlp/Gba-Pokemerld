# Plan técnico — emulador GBA en JavaScript para Pokémon Esmeralda

## Alcance y reglas
- Núcleo 100 % propio en JavaScript ES2020+: sin bibliotecas, sin WebAssembly y sin código de otros emuladores. Fuentes consultadas: GBATEK (documentación pública del hardware) y el manual de arquitectura ARM7TDMI.
- **No se incluyen la ROM ni la BIOS de Nintendo.** La BIOS se sustituye por una capa HLE (emulación de alto nivel) y un vector de interrupción mínimo escrito para este proyecto (`src/bios/`).
- La ROM se lee en el navegador con la File API y nunca sale del equipo.

## Requisitos que impone Pokémon Esmeralda (medidos en la ROM y en la descompilación)
| Subsistema | Requisito | Evidencia |
|---|---|---|
| CPU | ARM + Thumb completos, IRQ, cambio de modo, SWI | Código compilado Thumb + rutinas ARM en IWRAM (m4a) |
| BIOS (SWI) | LZ77 Wram/Vram (169 llamadas), RL Wram/Vram, CpuSet, CpuFastSet, ObjAffineSet, BgAffineSet, ArcTan, ArcTan2, Sqrt, Div, VBlankIntrWait, IntrWait, SoftReset, RegisterRamReset, MultiBoot, **0x2A MusicPlayerJumpTableCopy** | Recuento en `src/*.c` de la descompilación; `m4a.c:356` |
| 0x2A | Sin BIOS real, se copia la plantilla de 36 rutinas m4a **del propio juego** | Localizada por forma en BPES `0x677F94` (única coincidencia); se valida en ejecución con las 4 entradas que el juego sobrescribe |
| Guardado | Flash 128 KiB (FLASH1M_V103), IDs reconocidos: Macronix 0xC2/0x09 y Sanyo 0x62/0x13 | `agb_flash_1m.c`, `agb_flash_mx.c`, `agb_flash_le.c` |
| RTC | Seiko S-3511 por GPIO (0x080000C4–C9) | `siirtc.c`. Sin él, el juego avisa de que la pila interna se ha agotado |
| Vídeo | Modo 0 + modos afines (1/2) en efectos, sprites normales y afines, ventanas, mezcla alfa y brillo | Uso general del motor del juego |
| Audio | Direct Sound A/B (FIFO + timers + DMA1/2) y canales PSG 1–4 | `m4a.c` (mezcla por software → FIFO) |

## Arquitectura
```
src/emulator.js          bucle de fotograma: 228 líneas × 1232 ciclos; eventos HDraw/HBlank/VBlank
src/cpu/                 ARM7TDMI: registros con bancos, CPSR/SPSR, excepciones, decodificación por tablas
src/memory/bus.js        mapa de memoria, espejos, accesos 8/16/32, open bus, ciclos de espera aproximados
src/memory/io.js         registros de E/S → módulos de hardware
src/video/               PPU por scanlines: modos 0–5, BG de texto/afines/bitmap, OBJ, ventanas, mezcla
src/audio/               APU: PSG 1–4, FIFO A/B, mezcla → Web Audio
src/hardware/            IRQ, timers (con cascada), DMA (inmediato/VBlank/HBlank/FIFO), teclado
src/cartridge/           cargador y validación de ROM, Flash/SRAM/EEPROM, GPIO + RTC
src/bios/                HLE de SWI + vector IRQ propio
src/storage/             IndexedDB: guardados del cartucho (separados de los estados rápidos)
src/debug/               registro de instrucciones/excepciones, inspectores
src/ui/                  interfaz, controles táctiles y de teclado configurables
tools/headless.mjs       ejecución sin navegador (Node) para pruebas con la ROM real y capturas
```

## Fases y verificación
| Fase | Entregable | Prueba verificable |
|---|---|---|
| 1 | Bus y memoria | Espejos, alineación, escrituras de 8 bits en VRAM/PAL/OAM (pruebas unitarias) |
| 2–3 | CPU ARM + Thumb | Programas de prueba ensamblados a mano: flags, desplazamientos, multiplicaciones, LDM/STM, cambio de modo, excepciones |
| 4 | Cargador + HLE BIOS | Cada SWI contra resultados calculados de forma independiente; arranque de Esmeralda sin excepciones |
| 5 | PPU | Escenas sintéticas por modo; capturas de la ROM real |
| 6–7 | Temporización, DMA, IRQ | Pruebas de timers en cascada, DMA de repetición, VBlankIntrWait |
| 8 | Audio | Señal de canales y FIFO; reproducción en el juego |
| 9 | Guardado | Máquina de estados Flash (ID, borrado, escritura, bancos); guardar y recargar en el juego |
| 10–12 | Compatibilidad e interfaz | Lista de comprobación de `docs/COMPATIBILIDAD.md`, verificada con capturas reales |

Regla: **no se marca nada como completo sin una prueba o una captura del juego real** que lo demuestre.

## Estado de las fases (actualizado)
| Fase | Estado | Verificación |
|---|---|---|
| 1 Bus y memoria | ✅ | Pruebas de espejos, bytes en VRAM/PAL/OAM, ROM de solo lectura y protección de BIOS |
| 2–3 CPU ARM/Thumb | ✅ | 26 pruebas con programas codificados a mano (flags, desplazador, multiplicaciones largas, LDM/STM, modos, IRQ, los 19 formatos Thumb) |
| 4 Cargador y BIOS HLE | ✅ | Pruebas de SWI (Div, Sqrt, CpuSet, CpuFastSet, LZ77, RL, afines, ArcTan, IntrWait); arranque real |
| 5 PPU | ✅ | Escenas sintéticas (bitmap, tiles con volteo, sprites, ventanas, oscurecido) + capturas reales |
| 6–7 Temporización, DMA, IRQ | ✅ | Pruebas de timers en cascada y DMA; el juego funciona con VBlank/VCount/serie |
| 8 Audio | 🟡 | Síntesis y salida implementadas; música del título generada; evaluación auditiva pendiente |
| 9 Guardado | ✅ | Flash: pruebas de la máquina de estados + guardado y recuperación en el juego real |
| 10 Compatibilidad | 🟡 | Ver COMPATIBILIDAD.md (combate y captura sin verificar todavía) |
| 11 Interfaz | ✅ | Chromium: carga, controles, pantalla completa, audio, guardado, estados, panel de desarrollador |
| 12 Partida completa | ⏳ | En curso |
