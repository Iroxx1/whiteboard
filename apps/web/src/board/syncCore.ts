// Pure parts of the client sync (PLAN.md 5.3), kept free of Excalidraw and socket.io for tests.
import { compareByIndex, incomingWins, type SceneElement } from '@wb/shared'

type Versioned = Pick<SceneElement, 'id' | 'version' | 'versionNonce' | 'index'>

/** Ids whose local version differs from the version the server is known to have. */
export function changedIds(elements: readonly Versioned[], known: ReadonlyMap<string, number>): string[] {
  const ids: string[] = []
  for (const element of elements) if (known.get(element.id) !== element.version) ids.push(element.id)
  return ids
}

/**
 * After (re)joining, the server state is authoritative. Only elements changed locally and not yet
 * confirmed are kept, and only if they win against the server's copy; they must be sent again.
 * Everything else local is dropped, so tombstones the server already purged do not come back
 * from long-open tabs (PLAN.md 5.3, "Robustheit").
 */
export function mergeAfterJoin<T extends Versioned>(
  local: readonly T[],
  server: readonly T[],
  pending: ReadonlySet<string>,
): { scene: T[]; resend: T[] } {
  const byId = new Map(server.map((element) => [element.id, element]))
  const resend: T[] = []
  for (const element of local) {
    if (!pending.has(element.id)) continue
    if (incomingWins(byId.get(element.id), element)) {
      byId.set(element.id, element)
      resend.push(element)
    }
  }
  return { scene: [...byId.values()].sort(compareByIndex), resend }
}
