# Análisis binario — Pokémon Edición Esmeralda (España), código `BPES`

Generado con `node cli/analyze.js <rom> reports/BPES.json` (informe JSON completo, de uso local y fuera del control de versiones).
La ROM se abrió en solo lectura y su SHA-1 es el mismo antes y después del análisis.
Este documento solo recoge **offsets y estructura**. No incluye ni reproduce recursos del juego.

> **Autorización.** El archivo es un volcado comercial sin modificar: lo indican la marca TorrentZip y el código de juego `BPES`. El nombre del zip ("Emeraldmon") no corresponde a un hack. Analizar su estructura con fines de investigación es distinto de reutilizar sus recursos. **Ningún recurso extraído de esta ROM debe integrarse en el motor sin una licencia del titular de los derechos.** Las pruebas del proyecto usan exclusivamente datos sintéticos.

## 1. Archivo
| Dato | Valor | Evidencia |
|---|---|---|
| Tamaño | 16 777 216 B (16 MiB, potencia de 2) | Confirmado |
| SHA-1 | `fe1558a3dcb0360ab558969e09b690888b846dd9` | Medido. No se ha cotejado con una base de datos de volcados. |
| CRC32 | `0x8C4D3108` | Medido |
| Fin de datos | `0x00E3CF64` (89 %); después, 1 847 452 B de relleno `0xFF` | Confirmado |

## 2. Cabecera
| Campo | Valor | Evidencia |
|---|---|---|
| Entrada | `0xEA00007F` → `B 0x08000204` | Confirmado (decodificación) |
| Título / código / fabricante | `POKEMON EMER` / `BPES` / `01` | Leído |
| Destino | `S` = español | Confirmado (GBATEK) |
| Byte fijo 0xB2 | `0x96` | Confirmado |
| Reservado 0xB5–0xBB | todo 0 | Confirmado |
| Versión | 0 | Leído |
| Complemento | `0x64`, igual al recalculado | Confirmado |
| CRC32 del logo | `0xD0BEB55E` | **Hipótesis**: falta cotejarlo con un logo de referencia |
| Guardado | `FLASH1M_V103` en `0x009A5674` → Flash de 128 KiB | Confirmado (firma de biblioteca) |

## 3. Mapa de regiones (bloques de 4 KiB, solo los tramos de 128 KiB o más)
| Inicio | Fin | Clase | Entropía media |
|---|---|---|---|
| 0x000000 | 0x2F1000 | media | 6.03 |
| 0x33E000 | 0x35F000 | media | 6.43 |
| 0x387000 | 0x3C9000 | media | 5.32 |
| 0x679000 | 0x6A0000 | baja | 2.10 |
| 0x8FE000 | 0x9A6000 | media | 5.93 |
| 0x9C4000 | 0xB00000 | relleno 00 | — |
| 0xB00000 | 0xB99000 | media | 6.25 |
| 0xB99000 | 0xC00000 | relleno 00 | — |
| 0xC00000 | 0xD3C000 | media | 5.27 |
| 0xDEB000 | 0xE38000 | relleno 00 | — |
| 0xE3D000 | 0x1000000 | relleno FF | — |

Mapa completo de 336 regiones en `reports/BPES.json → regions`.

**Hipótesis H1.** `0x000000–0x2F1000` contiene principalmente código y datos sin comprimir. Indicios: allí está el punto de entrada (0x204) y el primer recurso LZ77 corroborado aparece en `0x2F4018`.
*Pendiente:* desensamblar Thumb/ARM para delimitar el código. El bit 0 de los punteros **no** sirve para esto: hay destinos impares repartidos por todos los MiB de la ROM, lo que encaja con punteros a datos alineados a byte (por ejemplo, texto).

**Hipótesis H2.** Los bloques alineados de `0xB00000` y `0xC00000`, seguidos de relleno con 00, indican recursos colocados a propósito en límites de 1 MiB. Que haya relleno con 00 por dentro de los datos útiles es un hecho medido; la intención, no.

## 4. Punteros
- Hay 91 547 palabras con forma de puntero ROM, hacia 64 665 destinos distintos.
- También aparecen 29 771 palabras con forma de puntero a EWRAM, 13 997 a IWRAM y 1 121 a E/S.
- Hay 893 tramos de 8 o más punteros seguidos (posibles tablas de punteros; hipótesis).
- Destinos más referenciados: `0x30579C` (925 refs) y `0x2F3E34` (857 refs). Están **sin interpretar**.

## 5. Compresión LZ77
| Métrica | Valor |
|---|---|
| Cabeceras `0x10` alineadas, con tamaño entre 32 B y 256 KiB | 10 293 |
| Flujos inválidos (casi todos por referencias anteriores al inicio) | 5 932 |
| Flujos válidos | 4 361 |
| **Corroborados** (flujo válido + puntero al offset) | **4 256** |
| Hipótesis (válidos, sin puntero) | 104 |
| Rechazados por solapamiento | 1 |
| Bytes corroborados, comprimidos → descomprimidos | 2,42 MB → 6,84 MB |
| Referencias con disp=1 (no aptas para VRAM) | 0 |

Tamaños descomprimidos más frecuentes: 32 B ×1543, 2048 B ×1108, 4096 B ×475, 288 B ×261, 512 B ×70 y 8192 B ×66.
**Que un recurso esté corroborado solo significa que es un recurso comprimido real. No dice nada sobre si es un tile, una paleta o un mapa.**

## 6. Tablas de estructuras descubiertas (paso fijo y punteros a LZ77)
Las genera `findStridedTables`. Ninguna se ha supuesto de antemano.

| Inicio | Paso | Entradas | Campo +4 = tamaño | Tamaños descomprimidos | Nivel |
|---|---|---|---|---|---|
| 0x30767C | 8 | 440 | 433/440 | 2048 ×433, 8192 ×7 | Corroborado |
| 0x308B1C | 8 | 440 | 438/440 | 2048 ×438, 4096 ×1, 8192 ×1 | Corroborado |
| 0x3098DC | 8 | 880 | — | 32 ×878, 128 ×2 | Hipótesis |
| 0x3103F0 | 8 | 440 | — | 4096 ×439, 8192 ×1 | Hipótesis |
| 0x5281A0 | 8 | 289 | 278/289 | variados | Corroborado |
| 0x30B8B8 | 8 | 93 | 87/93 | 2048 ×93 | Corroborado |
| 0x30BBA0 | 8 | 93 | — | 32 ×93 | Hipótesis |
| 0x617250 | 4 | 756 | — | 32 ×378, 288 ×378 | Hipótesis |

**Hipótesis H3** (consistente con la descompilación comunitaria y pendiente de verificar en esta ROM): las tablas de 8 bytes con `+4 = tamaño` siguen el layout `{u32 puntero; u16 tamaño; u16 etiqueta}`, que coincide con `struct CompressedSpriteSheet` de `pokeemerald`. Hay tres tablas de 440 entradas seguidas (0x30767C, 0x308B1C y 0x3103F0), una zona de 880 recursos de 32 B (2×440) justo después y una pareja 93/93 de recursos de 2048 B y 32 B. Esa disposición encaja con *sprites de especie + paletas normal/variocolor* y con *sprites de entrenador + paletas*, pero **nada de esto está confirmado**. Para confirmarlo hay que decodificar con la paleta de la entrada pareja y comprobar si sale una imagen coherente (fase 2).
**Excepciones medidas** en 0x30767C: 7 entradas declaran 2048 B y se descomprimen en 8192 B (índices 282, 284, 286, 343, 358, 385 y 406). No se interpretan.

## 6b. Verificación con las definiciones de la descompilación (fase 2)
Fuente de los layouts: `github.com/marcoscodas/bravely-emerald` (commit `949c610`), un port en C basado en `pret/pokeemerald`. **Solo se tomaron definiciones de estructuras y constantes, no direcciones:** las de la descompilación son de la versión inglesa. Cada estructura se localizó en esta ROM por su forma (`src/structures/schemas.js`).

| Hipótesis | Prueba | Resultado | Nuevo nivel |
|---|---|---|---|
| H3: tablas `{ptr, u16 size, u16 tag}` | Etiquetas de 0x30767C, 0x308B1C y 0x3103F0 frente a 0x3098DC | 440/440 en las tres | — |
| H3: paletas variocolor | Etiqueta en 0x30A69C = etiqueta + 500 (`SPECIES_SHINY_TAG`, include/data.h:6) | 440/440 | **Confirmado** |
| H3: tamaño de tabla | 440 = `SPECIES_UNOWN_QMARK` + 1 (include/constants/species.h) | Coincide | Confirmado |
| H3: semántica | Decodificación de la entrada 25 con su paleta emparejada; ancho de 64 px por `SPRITE_SHAPE(64x64)` (src/pokemon.c:2145) | Imagen coherente; 0x3103F0 = 2 fotogramas de 64×64, 0x30767C = 1 fotograma | **Confirmado (visual)** |
| Mapas | `MapLayout` + `Tileset` (include/global.fieldmap.h:55,66), con el primario `isSecondary=0` y el secundario `isSecondary=1` | 440 layouts y 73 tilesets contiguos en 0x3E2D60–0x3E3470. La descompilación lista 441 IDs de layout (diferencia de 1, sin explicar) | Corroborado |
| Mapas: semántica | Render del layout 0x3E3B80 con las reglas de carga de src/fieldmap.c:903–984 | Pueblo completo y coherente, 0 errores, 0 píxeles fuera de paleta | **Confirmado (visual)** |

Otras parejas de tablas encontradas: 0x30B8B8↔0x30BBA0 (93 entradas, etiquetas = índice → solo corroborado), 0x3326BC↔0x33271C y 0x5E7E6C↔0x5E7ECC (12 entradas, etiquetas no triviales → confirmado). Su significado está **sin verificar**.

**Errores de interpretación abiertos**
- El layout 0x3ED8E0 (20×20) usa los metatiles 586/587, que apuntan a los tiles 802–819. Superan los tiles descomprimidos del tileset secundario. El juego copia siempre 512 tiles (fieldmap.c:968) aunque los datos sean más cortos, así que en el hardware se verían bytes residuales de VRAM. Hipótesis: esos metatiles no son visibles o son residuales. Pendiente.
- Excepciones de tamaño en 0x30767C (7 entradas declaran 2048 B y se descomprimen en 8192 B): **explicadas en parte**. El campo `size` es la constante `MON_PIC_SIZE` (src/data.c:301 `SPECIES_SPRITE`), no el tamaño real. La entrada 385 (Castform) contiene 4 formas concatenadas (graphics_file_rules.mk:34). Para las entradas 282, 284, 286, 343, 358 y 406 (Blaziken, Marshtomp, Poochyena, Walrein, Swablu y Rayquaza en el orden de la descompilación), el motivo del tamaño mayor queda como hipótesis.

## 6c. Tablas de animación (fase 3b)
Detector por forma: `src/structures/animations.js` (tabla → arrays de punteros → secuencias `AnimCmd` terminadas en END/JUMP).
| Tabla | Entradas | Observación | Nivel |
|---|---|---|---|
| 0x30FD10 | 440 | Arrays de 2 o 3 secuencias. Junto a la tabla de sprites 0x3103F0. El inspector la elige por evidencia (439/440 entradas solo usan fotogramas existentes) | **Confirmado**: sus 440 entradas coinciden secuencia a secuencia con `gMonFrontAnimsPtrTable` de la descompilación (439 con SINGLE/DOUBLE_ANIMATION y Castform con su array propio de 4) |
| 0x3068BC | 440 | Arrays cortos, casi todos con el fotograma fijo | Corroborado; significado sin verificar |
| 0x30B5D0 | 93 | Mismo número de entradas que los sprites 0x30B8B8 | Corroborado; sin verificar |
| 0x30BF70 | 8 | — | Corroborado; sin verificar |

`0x30579C`, el destino más referenciado de la ROM en la fase 1 (925 refs), es `sAnim_GeneralFrame0` = `{FRAME(0,0), END}` (src/data.c:115). **Confirmado.**
Un detalle de semántica comprobado al portar `src/sprite.c`: `LOOP(n)` ejecuta el bloque n+1 veces.

## 7. Errores de interpretación
El análisis no registró ningún error. Fallos de descompresión por motivo: "Referencia anterior al inicio" ×5931 y "Referencia excede el tamaño declarado" ×1. Son cabeceras casuales y entran dentro de lo esperado.

## 8. Siguiente verificación
1. Error de tiles del layout 0x3ED8E0 y diferencia de 440 frente a 441 layouts.
2. Las 7 excepciones de 8192 B.
3. Significado de las tablas 0x3068BC, 0x30B5D0 y 0x30BF70.
4. Desensamblar desde 0x204 para H1.
