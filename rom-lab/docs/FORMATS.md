# Formatos binarios y gráficos de GBA — referencia del proyecto

Este documento describe **formatos**, no el contenido de ninguna ROM concreta.
Cada apartado indica su **fuente** y su **nivel de evidencia**:

| Nivel | Significado |
|---|---|
| **Hardware/BIOS** | Lo define el hardware o la BIOS de GBA. Fuente: GBATEK (Martin Korth). Es igual para todos los juegos. |
| **Específico del juego** | Lo define el código del juego. Fuente: proyecto comunitario de descompilación `pokeemerald` (versión **inglesa**). **Las direcciones de la versión española son otras.** Una estructura del juego solo se acepta para una ROM cuando el analizador la encuentra en esa ROM. |
| **Heurística del proyecto** | Umbral o criterio elegido aquí. Es revisable y no tiene autoridad externa. |

---

## 1. Contenedor: el archivo ROM

### 1.1 Mapa de memoria — *Hardware*
- La ROM se ve en `0x08000000–0x09FFFFFF` (32 MiB máx.) y tiene espejos en `0x0A…` y `0x0C…` (estados de espera).
- Offset en archivo = dirección − `0x08000000`.
- Otras regiones que aparecen en punteros: EWRAM `0x02000000` (256 KiB), IWRAM `0x03000000` (32 KiB), E/S `0x04000000`, paleta `0x05000000` (1 KiB), VRAM `0x06000000` (96 KiB) y OAM `0x07000000` (1 KiB).

### 1.2 Cabecera (0x000–0x0BF) — *Hardware*
| Offset | Tamaño | Campo | Verificable |
|---|---|---|---|
| 0x000 | 4 | Instrucción ARM `B` al código de arranque | Sí (decodificación) |
| 0x004 | 156 | Logo comprimido de Nintendo (la BIOS lo comprueba) | Solo comparándolo con una referencia |
| 0x0A0 | 12 | Título ASCII | — |
| 0x0AC | 4 | Código de juego (4.º carácter = destino: `S` = español) | — |
| 0x0B0 | 2 | Código de fabricante | — |
| 0x0B2 | 1 | Fijo `0x96` | Sí |
| 0x0B3 | 1 | Código de unidad | — |
| 0x0B4 | 1 | Tipo de dispositivo | — |
| 0x0B5 | 7 | Reservado (0) | Sí |
| 0x0BC | 1 | Versión | — |
| 0x0BD | 1 | Complemento: `(-Σ[0xA0..0xBC] − 0x19) & 0xFF` | Sí (checksum) |

### 1.3 Clasificación de regiones — *Heurística del proyecto*
Bloques de 4 KiB. `fill-FF` y `fill-00` son bloques uniformes. Por entropía de Shannon: `< 3.0` baja, `> 7.2` alta y el resto media.
**La entropía no identifica el tipo de dato.** Una entropía alta sugiere datos comprimidos o aleatorios. Una entropía media aparece en código Thumb, gráficos sin comprimir y tablas. El mapa sirve para orientarse, no para concluir.

### 1.4 Punteros — *Hardware (rango) + heurística (interpretación)*
Un puntero candidato es una palabra alineada a 4 dentro de `[0x08000000, 0x08000000 + tamaño)`.
- Bit 0 activo: posible dirección de código Thumb (las funciones Thumb se llaman con `BX` y el bit 0 a 1). Es una hipótesis: un dato también puede ser impar.
- 8 o más punteros seguidos forman una posible tabla de punteros (hipótesis).

### 1.5 Firmas de guardado — *Hardware/biblioteca*
La biblioteca de guardado de Nintendo incrusta cadenas como `EEPROM_Vnnn`, `SRAM_Vnnn`, `FLASH_Vnnn`, `FLASH512_Vnnn` o `FLASH1M_Vnnn`. Su presencia identifica el tipo de memoria de guardado.

---

## 2. Formatos gráficos

### 2.1 Color BGR555 — *Hardware*
Cada color es un u16 little-endian: `bits 0–4 R`, `5–9 G`, `10–14 B`, con el bit 15 sin uso.
Paso a 8 bits por canal: `c8 = (c5 << 3) | (c5 >> 2)`. Es la convención de escalado más habitual; el hardware no define ninguna conversión a 8 bits.

### 2.2 Paletas — *Hardware*
- La RAM de paleta mide 1 KiB: 512 bytes para fondos (BG) y 512 para sprites (OBJ).
- En modo 4bpp hay 16 paletas de 16 colores (32 bytes cada una). En modo 8bpp hay una paleta de 256 colores.
- **El índice 0 es transparente** en fondos y sprites (salvo el color 0 de la paleta 0 de BG, que es el color de fondo).
- En una ROM las paletas pueden estar en bruto (32·n bytes) o comprimidas con LZ77.

### 2.3 Tile 8×8 en 4bpp — *Hardware*
32 bytes, 4 por fila y 8 filas. Cada byte contiene dos píxeles: **el nibble bajo es el píxel izquierdo** y el nibble alto el derecho. El valor (0–15) es un índice dentro de la paleta de 16 colores seleccionada.

### 2.4 Tile 8×8 en 8bpp — *Hardware*
64 bytes, un byte por píxel, en filas de izquierda a derecha. El valor (0–255) indexa la paleta de 256 colores.

### 2.5 Tilemaps — *Hardware*
**Fondos de texto (modos 0/1):** cada entrada es un u16:
```
bits 0–9   índice de tile (0–1023)
bit 10     volteo horizontal
bit 11     volteo vertical
bits 12–15 número de paleta (solo en 4bpp)
```
Un "screenblock" contiene 32×32 entradas (2 KiB). Los fondos de 64×32, 32×64 o 64×64 tiles usan 2 o 4 screenblocks **en orden de bloque**, no en filas continuas de 64. Es decir, el bloque 0 es el cuarto superior izquierdo y el bloque 1 el superior derecho.

**Fondos afines (modos 1/2):** cada entrada es un u8 con solo el índice de tile (siempre 8bpp, sin volteo ni paleta).

### 2.6 Sprites (OBJ) — *Hardware*
Las dimensiones salen del atributo OAM (forma y tamaño): 8×8 a 64×64, cuadrados, horizontales o verticales.
- **Mapeo 1D:** los tiles del sprite son consecutivos en VRAM, fila a fila del sprite.
- **Mapeo 2D:** la VRAM se trata como una matriz de 32 tiles de ancho.

**Un bloque de tiles comprimido no indica sus dimensiones.** Hay que obtenerlas de la estructura que lo referencia o del código que lo usa. Ejemplo de ambigüedad: 2048 bytes caben en 64 tiles 4bpp, que pueden ser 64×64, 32×128, 128×32 o dos fotogramas de 64×32; esos mismos 2048 bytes también encajan con un screenblock de tilemap.

### 2.7 Compresión LZ77 — *BIOS (SWI 0x11/0x12)*
- Cabecera u32: el byte 0 vale `0x10` y los bits 8–31 dan el tamaño descomprimido.
- El origen debe estar **alineado a 4**.
- Cada byte de flags rige 8 elementos, del MSB al LSB. Un 0 indica un literal de 1 byte. Un 1 indica una referencia de 2 bytes: `len = (b0>>4)+3`, `disp = ((b0&0xF)<<8 | b1)+1`.
- La variante para VRAM (SWI 0x12) escribe de 16 en 16 bits, así que una referencia con `disp = 1` corrompe los datos en VRAM.
- Detección (criterios C1–C5): ver `src/analyzer/lz77scan.js`. Si el flujo es válido y además lo apunta un puntero, el candidato queda **corroborado**, no confirmado: su significado (tiles, paleta, mapa…) sigue sin verificarse.

Existen otros formatos de la BIOS (Huffman `0x2x`, RLE `0x30`, filtros diferenciales `0x8x`). No están implementados todavía y el escáner actual no los busca.

### 2.8 Metatiles — *Específico del juego*
No es un concepto del hardware. En `pokeemerald` un metatile mide 16×16 px y son **8 entradas de tilemap** (u16 con el formato de §2.5): 4 para la capa inferior y 4 para la superior (2×2 cada una). Además lleva atributos aparte (comportamiento y capa) en otra tabla. Los tilesets se dividen en primario y secundario.
**Estado en BPES:** localizado por forma (`MapLayout` → `Tileset`) y confirmado visualmente; ver docs/ANALISIS_BPES.md §6b. Reglas de carga: primario = tiles 0–511 y paletas 0–5 (color 0 forzado a negro); secundario = tiles 512–1023 y paletas 6–12. En ambas capas el índice 0 deja ver el *backdrop*.

### 2.9 Animaciones — *Específico del juego*
El hardware no tiene un formato de animación: el juego cambia tiles en VRAM o atributos OAM por software.
En `pokeemerald` existen secuencias `union AnimCmd` de 4 bytes (include/sprite.h): un `s16` con valor −1 = END, −2 = JUMP o −3 = LOOP; cualquier otro valor es FRAME (imageValue:16, duration:6, hFlip, vFlip). También hay animaciones de tiles de tilesets (callbacks que copian a VRAM). Decodificador: `src/decoders/anim.js`. **Estado: secuencias no localizadas en esta ROM.**

---

## 3. Cómo se relacionan

```
 ROM ──(puntero)──► bloque LZ77 ──(SWI 0x11)──► bytes descomprimidos
                                                     │
            ┌────────────────────────────┬──────────┴──────────┐
            ▼                            ▼                     ▼
   Tiles 8×8 (4bpp/8bpp)          Paleta BGR555          Tilemap (u16)
   índices de color          ◄─── da color a ────    elige tile + paleta + volteo
            │                                                  │
            ├── Sprite: N tiles + dimensiones OAM + mapeo 1D/2D │
            └── Metatile (juego): 2×2 entradas × 2 capas ◄──────┘
                         │
               Mapa del juego = cuadrícula de metatiles
   Animación (juego) = secuencia de fotogramas (índices de tile / sprite) + duraciones
```
Ningún bloque es interpretable por sí solo. Para reconstruir una imagen hacen falta, como mínimo, **tiles + paleta + dimensiones (o tilemap)**. Las tres cosas deben salir de evidencia: la estructura que las agrupa o el código que las carga.
