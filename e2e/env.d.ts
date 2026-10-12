// The board page exposes its Excalidraw API for tests (apps/web/src/board/BoardPage.tsx).
interface Window {
  __wb?: {
    api: {
      getSceneElements: () => readonly ({ id: string; type: string; isDeleted: boolean } & Record<string, unknown>)[]
      getAppState: () => { collaborators: Map<string, { username?: string | null }> }
    }
    sync: { isJoined: boolean }
  }
}
