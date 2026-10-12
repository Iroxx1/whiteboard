import { Excalidraw, MainMenu } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useQuery } from '@tanstack/react-query'
import type { BoardDetail, Me } from '@wb/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { FullPageMessage, useMe } from '../lib/auth.tsx'
import { THEME_ORDER, useThemeSetting } from '../ui/ThemeToggle.tsx'
import { BoardSync, type SyncStatus } from './BoardSync.ts'
import { FileSync } from './FileSync.ts'
import { HistoryDialog } from './HistoryDialog.tsx'
import { StickyTool } from './StickyTool.tsx'
import { createStyleSaver, loadStyle } from './styleDefaults.ts'

declare global {
  interface Window {
    /** For end-to-end tests and debugging in the console. */
    __wb?: { api: ExcalidrawImperativeAPI; sync: BoardSync }
  }
}

function StatusBanner({ status }: { status: SyncStatus }) {
  if (status === 'connected' || status === 'connecting') return null
  const text =
    status === 'disconnected'
      ? de.board.disconnected
      : status === 'unauthorized'
        ? de.board.sessionEnded
        : status === 'deleted'
          ? de.board.deleted
          : de.board.notFound
  return (
    <div
      role="status"
      className="pointer-events-auto absolute top-16 left-1/2 z-20 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow dark:bg-amber-950 dark:text-amber-100"
    >
      <span>{text}</span>
      {status === 'unauthorized' && (
        <Link to={`/login?next=${encodeURIComponent(window.location.pathname)}`} className="font-medium underline">
          {de.board.toLogin}
        </Link>
      )}
      {(status === 'deleted' || status === 'not_found') && (
        <Link to="/" className="font-medium underline">
          {de.board.toDashboard}
        </Link>
      )}
    </div>
  )
}

function Editor({ board, me }: { board: BoardDetail; me: Me }) {
  const navigate = useNavigate()
  const { theme, preference, setPreference } = useThemeSetting()
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const syncRef = useRef<BoardSync | null>(null)
  const filesRef = useRef<FileSync | null>(null)
  const saveStyle = useMemo(() => createStyleSaver(me.id), [me.id])

  // Only the first render matters; later changes arrive through the sync.
  const [initialData] = useState(() => ({
    elements: board.elements as unknown as OrderedExcalidrawElement[],
    appState: { ...loadStyle(me.id), ...board.appState },
    scrollToContent: true,
  }))

  useEffect(() => {
    if (!excalidraw) return
    const files = new FileSync(board.id, excalidraw, () => setUploadError(true))
    const sync = new BoardSync(board.id, excalidraw, board, {
      onStatus: setStatus,
      onRemoteElements: (elements) => files.ensureFiles(elements),
    })
    syncRef.current = sync
    filesRef.current = files
    window.__wb = { api: excalidraw, sync }
    files.ensureFiles(excalidraw.getSceneElements())
    return () => {
      sync.stop()
      files.stop()
      syncRef.current = null
      filesRef.current = null
      window.__wb = undefined
    }
  }, [excalidraw, board])

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      syncRef.current?.handleChange(elements, appState)
      filesRef.current?.handleFiles(files)
      saveStyle(appState)
    },
    [saveStyle],
  )

  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length] ?? 'system'

  return (
    <div className="fixed inset-0">
      <Excalidraw
        excalidrawAPI={setExcalidraw}
        initialData={initialData}
        langCode="de-DE"
        theme={theme}
        // The board fills the page, so shortcuts work after clicking our own toolbar too.
        handleKeyboardGlobally
        isCollaborating={status === 'connected'}
        onChange={onChange}
        onPointerUpdate={({ pointer, button }) => syncRef.current?.handlePointer(pointer, button)}
        UIOptions={{
          canvasActions: {
            toggleTheme: false,
            loadScene: false,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
          },
        }}
        renderTopRightUI={() => (
          // Hidden on phones: Excalidraw needs the full width for its toolbar there.
          <span className="hidden max-w-[30vw] shrink-0 self-center truncate text-sm font-semibold sm:block">
            {board.name}
          </span>
        )}
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => navigate('/')}>← {de.board.menuBoards}</MainMenu.Item>
          <MainMenu.Item onSelect={() => setHistoryOpen(true)}>🕘 {de.board.menuHistory}</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.Item onSelect={() => setPreference(nextTheme)}>
            {de.board.menuTheme}: {de.theme[preference]}
          </MainMenu.Item>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      {excalidraw && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 sm:bottom-4">
          <StickyTool api={excalidraw} />
        </div>
      )}
      <StatusBanner status={status} />
      {uploadError && (
        <button
          type="button"
          onClick={() => setUploadError(false)}
          className="absolute top-28 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-[var(--wb-danger)] px-3 py-2 text-sm text-white shadow"
        >
          {de.board.imageUploadFailed} ✕
        </button>
      )}
      <HistoryDialog boardId={board.id} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  )
}

/** `/b/:boardId` (PLAN.md 5.13); loaded lazily because Excalidraw is large. */
export default function BoardPage() {
  const { boardId = '' } = useParams()
  const me = useMe()
  // Fetched once per visit; afterwards the socket keeps the scene current.
  const board = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api.board(boardId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (board.data) document.title = `${board.data.name} · ${de.appName}`
    return () => {
      document.title = de.appName
    }
  }, [board.data])

  if (board.isPending || !me.data) return <FullPageMessage>{de.board.loading}</FullPageMessage>
  if (board.error) {
    return (
      <FullPageMessage>
        <div className="flex flex-col items-center gap-3">
          <p>{de.board.notFound}</p>
          <Link to="/" className="text-[var(--wb-accent)] underline">
            {de.board.toDashboard}
          </Link>
        </div>
      </FullPageMessage>
    )
  }
  return <Editor key={board.data.id} board={board.data} me={me.data} />
}
