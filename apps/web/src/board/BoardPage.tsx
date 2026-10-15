import { Excalidraw, MainMenu, Sidebar, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type BoardDetail, type Item, itemIdFromLink, type Me } from '@wb/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { FullPageMessage, useMe } from '../lib/auth.tsx'
import { SearchButton } from '../search/SearchDialog.tsx'
import { THEME_ORDER, useThemeSetting } from '../ui/ThemeToggle.tsx'
import { BoardSync, type SyncStatus } from './BoardSync.ts'
import { FileSync } from './FileSync.ts'
import { HistoryDialog } from './HistoryDialog.tsx'
import { DRAG_TYPE, InboxPanel, useInboxCount } from './InboxPanel.tsx'
import { ItemCard } from './ItemCard.tsx'
import { ItemDetails } from './ItemDetails.tsx'
import { wbOf } from './itemElements.ts'
import { handleInboxChanged, handleItemUpdated, itemKey } from './itemsData.ts'
import { type PlacementNotice, Placer } from './Placer.ts'
import { isEditableTarget, onlyPdfs, urlFromText, urlFromUriList } from './pasteImport.ts'
import { StickyTool } from './StickyTool.tsx'
import { createStyleSaver, loadStyle } from './styleDefaults.ts'
import { ThumbnailSaver } from './thumbnail.ts'

declare global {
  interface Window {
    /** For end-to-end tests and debugging in the console. */
    __wb?: { api: ExcalidrawImperativeAPI; sync: BoardSync; placer: Placer }
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

/** Toast at the bottom: "Platziert · Rückgängig", "Wurde gerade von Anna platziert" … */
function NoticeToast({
  notice,
  onUndo,
  onClose,
}: {
  notice: PlacementNotice
  onUndo: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, notice.kind === 'placed' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [notice, onClose])
  const text =
    notice.kind === 'placed'
      ? de.inbox.placed
      : notice.kind === 'taken'
        ? de.inbox.placedBy(notice.holder)
        : de.inbox.imageNotReady
  return (
    <div
      role="status"
      className="pointer-events-auto absolute bottom-32 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-[#1e1e24] px-4 py-2 text-sm text-white shadow-lg sm:bottom-20"
    >
      <span>{text}</span>
      {notice.kind === 'placed' && (
        <button type="button" onClick={onUndo} className="font-semibold text-[#9db0ff] underline">
          {de.inbox.undo}
        </button>
      )}
      <button type="button" onClick={onClose} aria-label={de.common.close} className="opacity-70">
        ✕
      </button>
    </div>
  )
}

const isWide = () => window.matchMedia('(min-width: 1024px)').matches

function Editor({ board, me }: { board: BoardDetail; me: Me }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { theme, preference, setPreference } = useThemeSetting()
  const inboxCount = useInboxCount()
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [importError, setImportError] = useState(false)
  const [docked, setDocked] = useState(isWide)
  const [details, setDetails] = useState<string | null>(null)
  const [notice, setNotice] = useState<PlacementNotice | null>(null)
  const syncRef = useRef<BoardSync | null>(null)
  const filesRef = useRef<FileSync | null>(null)
  const placerRef = useRef<Placer | null>(null)
  const thumbRef = useRef<ThumbnailSaver | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const saveStyle = useMemo(() => createStyleSaver(me.id), [me.id])
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus')

  // Search hit on this board (PLAN.md 5.9): zoom to the element and select it, then drop ?focus.
  useEffect(() => {
    if (!excalidraw || !focus) return
    let tries = 0
    const timer = setInterval(() => {
      const element = excalidraw.getSceneElements().find((entry) => entry.id === focus)
      if (!element && ++tries < 20) return
      clearInterval(timer)
      if (element) {
        excalidraw.scrollToContent(element, { fitToViewport: true, viewportZoomFactor: 0.5, animate: true })
        excalidraw.updateScene({ appState: { selectedElementIds: { [element.id]: true } } })
      }
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('focus')
          return next
        },
        { replace: true },
      )
    }, 150)
    return () => clearInterval(timer)
  }, [excalidraw, focus, setParams])

  // Only the first render matters; later changes arrive through the sync. The inbox sidebar
  // starts open and docked on desktops (decided 12.10.2026).
  const [initialData] = useState(() => ({
    elements: board.elements as unknown as OrderedExcalidrawElement[],
    appState: {
      ...loadStyle(me.id),
      ...board.appState,
      ...(isWide() ? { openSidebar: { name: 'inbox' } } : {}),
    },
    scrollToContent: true,
  }))

  useEffect(() => {
    if (!excalidraw) return
    const files = new FileSync(board.id, excalidraw, () => setUploadError(true))
    // Dashboard preview: rendered after quiet times and when leaving, also on tab switch (Phase 10).
    const thumbnail = new ThumbnailSaver(
      board.id,
      board.thumbAt === null,
      () => void queryClient.invalidateQueries({ queryKey: ['boards'] }),
    )
    thumbRef.current = thumbnail
    const onHidden = () => document.visibilityState === 'hidden' && void thumbnail.flush()
    document.addEventListener('visibilitychange', onHidden)
    let placer: Placer | null = null
    const sync = new BoardSync(board.id, excalidraw, board, {
      onStatus: setStatus,
      onRemoteElements: (elements) => files.ensureFiles(elements),
      onInboxChanged: () => handleInboxChanged(queryClient),
      onItemUpdated: (itemId) => handleItemUpdated(queryClient, itemId),
      // Automatic placement in the "📥 Inbox" frame (PLAN.md 5.4).
      onPlacementPending: (itemIds) => void placer?.place(itemIds, { kind: 'frame' }, true),
    })
    placer = new Placer(
      excalidraw,
      sync,
      queryClient,
      (next) => setNotice(next),
      () => files.ensureFiles(excalidraw.getSceneElements()),
    )
    syncRef.current = sync
    filesRef.current = files
    placerRef.current = placer
    window.__wb = { api: excalidraw, sync, placer }
    files.ensureFiles(excalidraw.getSceneElements())
    return () => {
      sync.stop()
      files.stop()
      document.removeEventListener('visibilitychange', onHidden)
      thumbnail.stop()
      thumbRef.current = null
      syncRef.current = null
      filesRef.current = null
      placerRef.current = null
      window.__wb = undefined
    }
  }, [excalidraw, board, queryClient])

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      syncRef.current?.handleChange(elements, appState)
      filesRef.current?.handleFiles(files)
      thumbRef.current?.update(elements, files)
      saveStyle(appState)
    },
    [saveStyle],
  )

  const openDetails = useCallback(
    (itemId: string) => {
      // Phones get the page, desktops the side panel (PLAN.md 5.4 "Darstellung").
      if (window.matchMedia('(max-width: 639px)').matches) navigate(`/i/${itemId}`)
      else setDetails(itemId)
    },
    [navigate],
  )

  const placeAtCenter = useCallback(
    (itemIds: string[]) => {
      if (!excalidraw) return
      const state = excalidraw.getAppState()
      const center = viewportCoordsToSceneCoords(
        { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
        state,
      )
      void placerRef.current?.place(itemIds, { kind: 'point', x: center.x, y: center.y })
    },
    [excalidraw],
  )

  // Capturing listeners catch our drag type before Excalidraw handles the drop, and give cards
  // "double-click → details" and "Ctrl/Cmd+click → open link" (SPIKES.md).
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !excalidraw) return
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      const ids = event.dataTransfer?.getData(DRAG_TYPE)
      if (!ids) return
      event.preventDefault()
      event.stopPropagation()
      const point = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        excalidraw.getAppState(),
      )
      void placerRef.current?.place(ids.split(','), { kind: 'point', x: point.x, y: point.y })
    }
    const itemAt = (event: MouseEvent, types: string[]): ExcalidrawElement | undefined => {
      if (!(event.target instanceof HTMLCanvasElement)) return undefined
      const point = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        excalidraw.getAppState(),
      )
      return excalidraw
        .getSceneElements()
        .toReversed()
        .find(
          (element) =>
            types.includes(element.type) &&
            wbOf(element) !== undefined &&
            point.x >= element.x &&
            point.x <= element.x + element.width &&
            point.y >= element.y &&
            point.y <= element.y + element.height,
        )
    }
    const onDoubleClick = (event: MouseEvent) => {
      const element = itemAt(event, ['embeddable', 'image'])
      const itemId = element ? wbOf(element)?.itemId : undefined
      if (!itemId) return
      event.preventDefault()
      event.stopPropagation()
      openDetails(itemId)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const element = itemAt(event, ['embeddable'])
      const itemId = element ? wbOf(element)?.itemId : undefined
      const url = itemId ? queryClient.getQueryData<Item | null>(itemKey(itemId))?.url : null
      if (!url) return
      event.preventDefault()
      event.stopPropagation()
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    wrapper.addEventListener('dragover', onDragOver, true)
    wrapper.addEventListener('drop', onDrop, true)
    wrapper.addEventListener('dblclick', onDoubleClick, true)
    wrapper.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      wrapper.removeEventListener('dragover', onDragOver, true)
      wrapper.removeEventListener('drop', onDrop, true)
      wrapper.removeEventListener('dblclick', onDoubleClick, true)
      wrapper.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [excalidraw, openDetails, queryClient])

  // A pasted address or a dropped PDF becomes an inbox item and lands on the board as a card at the
  // pointer (Phase 10). Plain text, images and everything else stay with Excalidraw.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !excalidraw) return
    let pointer: { x: number; y: number } | null = null
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
    }
    const importItems = async (body: { url: string } | FormData, at: { x: number; y: number } | null) => {
      try {
        const result = await api.addItem(body)
        const state = excalidraw.getAppState()
        const spot = viewportCoordsToSceneCoords(
          at
            ? { clientX: at.x, clientY: at.y }
            : { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
          state,
        )
        const ids = [...result.items.map((entry) => entry.id), ...result.duplicateIds]
        void placerRef.current?.place(ids, { kind: 'point', x: spot.x, y: spot.y })
        void queryClient.invalidateQueries({ queryKey: ['items'] })
      } catch {
        setImportError(true)
      }
    }
    const pdfForm = (files: File[]) => {
      const form = new FormData()
      for (const file of files) form.append('files', file, file.name)
      return form
    }
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return
      const data = event.clipboardData
      if (!data) return
      const pdfs = onlyPdfs([...data.files])
      const url = pdfs ? null : urlFromText(data.getData('text/plain'))
      if (!pdfs && !url) return
      event.preventDefault()
      event.stopPropagation()
      void importItems(pdfs ? pdfForm(pdfs) : { url: url ?? '' }, pointer)
    }
    const onDropImport = (event: DragEvent) => {
      const data = event.dataTransfer
      // Our own inbox drags are handled by the listener above.
      if (!data || data.types.includes(DRAG_TYPE)) return
      const pdfs = onlyPdfs([...data.files])
      const url = pdfs ? null : urlFromUriList(data.getData('text/uri-list'))
      if (!pdfs && !url) return
      event.preventDefault()
      event.stopPropagation()
      void importItems(pdfs ? pdfForm(pdfs) : { url: url ?? '' }, { x: event.clientX, y: event.clientY })
    }
    wrapper.addEventListener('pointermove', onMove, true)
    wrapper.addEventListener('paste', onPaste, true)
    wrapper.addEventListener('drop', onDropImport, true)
    return () => {
      wrapper.removeEventListener('pointermove', onMove, true)
      wrapper.removeEventListener('paste', onPaste, true)
      wrapper.removeEventListener('drop', onDropImport, true)
    }
  }, [excalidraw, queryClient])

  const closeNotice = useCallback(() => setNotice(null), [])
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length] ?? 'system'

  return (
    <div ref={wrapperRef} className="fixed inset-0">
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
        validateEmbeddable={(link) => (itemIdFromLink(link) ? true : undefined)}
        renderEmbeddable={(element, appState) => {
          const wb = wbOf(element)
          if (!wb) return null
          return <ItemCard itemId={wb.itemId} zoom={appState.zoom.value} theme={appState.theme} />
        }}
        renderTopRightUI={() => (
          <>
            {/* Hidden on phones: Excalidraw needs the full width for its toolbar there. */}
            <span className="hidden max-w-[30vw] shrink-0 self-center truncate text-sm font-semibold sm:block">
              {board.name}
            </span>
            <SearchButton className="self-center" />
            <Sidebar.Trigger name="inbox" title={de.inbox.toggle}>
              📥 <span className="hidden sm:inline">{de.inbox.toggle}</span>
              {inboxCount > 0 && (
                <span className="ml-1 rounded-full bg-[var(--wb-accent)] px-1.5 text-xs text-white">{inboxCount}</span>
              )}
            </Sidebar.Trigger>
          </>
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
        <Sidebar name="inbox" docked={docked} onDock={setDocked}>
          <Sidebar.Header>📥 {de.inbox.title}</Sidebar.Header>
          <InboxPanel
            onPlaceHere={placeAtCenter}
            onPlaceAllInFrame={(ids) => void placerRef.current?.place(ids, { kind: 'frame' })}
            onDetails={openDetails}
          />
        </Sidebar>
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
      {importError && (
        <button
          type="button"
          onClick={() => setImportError(false)}
          className="absolute top-28 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-[var(--wb-danger)] px-3 py-2 text-sm text-white shadow"
        >
          {de.board.importFailed} ✕
        </button>
      )}
      {notice && (
        <NoticeToast
          notice={notice}
          onClose={closeNotice}
          onUndo={() => {
            if (notice.kind === 'placed') void placerRef.current?.undo(notice.placements, board.id)
            setNotice(null)
          }}
        />
      )}
      {details && (
        <aside className="absolute top-16 right-3 bottom-3 z-30 w-[380px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] shadow-xl">
          <ItemDetails key={details} itemId={details} onClose={() => setDetails(null)} />
        </aside>
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
