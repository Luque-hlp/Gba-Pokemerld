/**
 * Niveles de evidencia usados en TODOS los informes.
 * Ninguna estructura se presenta como "confirmada" sin una verificación reproducible.
 */
export const Evidence = Object.freeze({
  /** Verificado por especificación + comprobación (checksum, campo fijo, flujo válido referenciado por puntero...). */
  CONFIRMED: 'confirmed',
  /** Dos o más señales independientes coinciden, pero falta verificación semántica. */
  CORROBORATED: 'corroborated',
  /** Una sola señal heurística. Puede ser un falso positivo. */
  HYPOTHESIS: 'hypothesis',
  /** Se comprobó y no se cumple. */
  REJECTED: 'rejected',
});

/** Construye una afirmación trazable: qué se afirma, con qué nivel y en qué se basa. */
export function claim(statement, level, basis) {
  if (!Object.values(Evidence).includes(level)) throw new Error(`Nivel de evidencia desconocido: ${level}`);
  return { statement, level, basis: Array.isArray(basis) ? basis : [basis] };
}
