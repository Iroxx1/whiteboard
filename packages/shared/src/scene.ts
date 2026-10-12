// Scene elements as the server sees them: only the fields needed for reconciliation are typed,
// everything else is passed through untouched (board elements are created by the browser only,
// PLAN.md 2.3.4).

export type SceneElement = {
  id: string
  type: string
  version: number
  versionNonce: number
  isDeleted?: boolean
  index?: string | null
  updated?: number
  [key: string]: unknown
}

/** Board-level settings that are synced besides the elements (PLAN.md 5.3). */
export type BoardAppState = {
  viewBackgroundColor?: string
  gridModeEnabled?: boolean
}

type Versioned = Pick<SceneElement, 'version' | 'versionNonce'>

/**
 * Excalidraw's rule: the incoming element wins if there is none yet, if its version is higher,
 * or if the versions are equal and its versionNonce is lower.
 */
export function incomingWins(existing: Versioned | undefined, incoming: Versioned): boolean {
  if (!existing) return true
  if (incoming.version !== existing.version) return incoming.version > existing.version
  return incoming.versionNonce < existing.versionNonce
}

/** Storage order: by fractional index (plain string comparison), ties by id. */
export function compareByIndex(a: Pick<SceneElement, 'id' | 'index'>, b: Pick<SceneElement, 'id' | 'index'>): number {
  const ai = a.index ?? ''
  const bi = b.index ?? ''
  if (ai !== bi) return ai < bi ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
