import type { BoardAppState, SceneElement } from '@wb/shared'
import { z } from 'zod'

// Only the fields the server relies on are checked; the rest of an Excalidraw element is kept as is
// (board elements are created by the browser only, PLAN.md 2.3.4).
export const elementSchema = z.looseObject({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(40),
  version: z.number().int().nonnegative(),
  versionNonce: z.number().int(),
  isDeleted: z.boolean().optional(),
  index: z.string().max(500).nullable().optional(),
  updated: z.number().optional(),
})

export const appStateSchema = z.object({
  viewBackgroundColor: z.string().max(50).optional(),
  gridModeEnabled: z.boolean().optional(),
})

export const boardUpdateSchema = z.object({
  boardId: z.string().min(1).max(40),
  elements: z.array(elementSchema).max(20_000),
  appState: appStateSchema.optional(),
})

export function parseElementsJson(json: string): SceneElement[] {
  const parsed = JSON.parse(json) as unknown
  return Array.isArray(parsed) ? (parsed as SceneElement[]) : []
}

export function parseAppStateJson(json: string): BoardAppState {
  const result = appStateSchema.safeParse(JSON.parse(json))
  return result.success ? result.data : {}
}

/** File ids referenced by (non-deleted) image elements. */
export function referencedFileIds(elements: Iterable<SceneElement>): string[] {
  const ids = new Set<string>()
  for (const element of elements) {
    if (element.type === 'image' && !element.isDeleted && typeof element.fileId === 'string') ids.add(element.fileId)
  }
  return [...ids]
}
