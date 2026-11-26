# Compatibilidad con Pokémon Esmeralda (BPES, versión española)

Cada punto indica **cómo se verificó**. Herramientas: `tools/headless.mjs` (ejecución sin navegador con
capturas), Chromium mediante Playwright (aplicación web real) y estados rápidos para repetir escenas.
Las capturas del juego no se incluyen en el repositorio porque su contenido pertenece a Nintendo.

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Abrir la aplicación en el navegador | ✅ | Chromium: servidor local, `file://` (archivo único) y contenedor Docker; 0 errores de JavaScript |
| 2 | Seleccionar la ROM local | ✅ | File API; cabecera, checksum, Flash 1M y RTC detectados; errores legibles para `.zip` y archivos inválidos (pruebas) |
| 3 | Iniciar el juego original | ✅ | Arranque desde 0x08000000 con BIOS HLE |
| 4 | Pantalla de inicio | ✅ | Intro de GAME FREAK y pantalla de título con Rayquaza renderizadas |
| 5 | Partida nueva | ✅ | Menú principal (PARTIDA NUEVA / OPCIONES; sin CONTINUAR con la Flash vacía) |
| 6 | Elegir nombre | ✅ (con el nombre por defecto) | Se supera la pantalla de nombre (START → OK); no se ha probado escribir un nombre letra a letra |
| 7 | Explorar los mapas originales | ✅ | Camión de mudanzas (con efecto de ventana), Villa Raíz, interior de la casa, transiciones con fundido |
| 8 | Caminar e interactuar con NPC | ✅ | Diálogos del Prof. Abedul y de MAMÁ; cajas del camión (mensaje de 2 páginas) |
| 9 | Combates | ⏳ sin verificar | Aún no se ha llegado al primer combate en las pruebas automatizadas |
| 10 | Capturar criaturas | ⏳ sin verificar | Requiere avanzar más en el juego |
| 11 | Usar objetos | ⏳ sin verificar | |
| 12 | Inventario | 🟡 parcial | El menú START (MOCHILA, jugador, GUARDAR, OPCIONES) se abre; la mochila no se ha abierto aún |
| 13 | Guardar la partida | ✅ | GUARDAR → SÍ: el juego programa 57 344 bytes (14 sectores) en la Flash emulada |
| 14 | Cerrar la página y recuperar el progreso | ✅ | Chromium: importar/exportar `.sav` idéntico byte a byte; tras recargar la página, IndexedDB devuelve la partida y CONTINUAR la reanuda en la casa |
| 15 | Seguir jugando | ✅ | Tras CONTINUAR el juego responde a los controles |
| — | Audio | 🟡 | Música del título generada (≈ 32 768 muestras/s, nivel RMS 0,06; canales PSG y Direct Sound). Falta una evaluación auditiva de calidad |
| — | Rendimiento | ✅ | ≈ 240 fotogramas/s sin navegador; 59–60 FPS estables en Chromium |

## Incidencias encontradas y corregidas
| Incidencia | Causa | Corrección |
|---|---|---|
| El vector de IRQ saltaba a 0x120 en vez de 0x128 | Cálculo erróneo del desplazamiento del `B` en la BIOS propia | `0xEA000042`; detectado con el registro de ejecución |
| El juego no avanzaba tras PARTIDA NUEVA | El puerto serie no emulaba «nada conectado»: la detección del adaptador inalámbrico (RCNT/SIOCNT) no terminaba | `src/hardware/serial.js`: entradas en alto (pull-up) y transferencias con reloj interno que devuelven 0xFFFF |
| Thumb formatos 7/8 (LDR/STR con registro) | Tabla de tipos en orden incorrecto | Orden real de los bits 11–9; cubierto por pruebas |
| Lectura de PC incorrecta en el modo bitmap | Se leía BG2PB en vez de BG2PC | Corregido en `background.js` |
| Empaquetado de archivo único | Dependencia circular `arm.js` ↔ `arm7tdmi.js` | Eliminada |

## Limitaciones conocidas
- EEPROM: no implementada (Esmeralda usa Flash). SRAM y Flash 64/128 KiB sí.
- Temporización aproximada: costes de ciclo medios por región y sin emulación exacta del prefetch.
- El modo Stop se trata como Halt. No hay cable de enlace ni adaptador inalámbrico (se emula «desconectado»).
- La tabla de senos de BgAffineSet/ObjAffineSet se calcula con `Math.sin` (puede diferir en ±1 del valor de la BIOS real).
