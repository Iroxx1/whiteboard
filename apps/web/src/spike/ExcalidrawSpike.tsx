import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  ROUNDNESS,
  reconcileElements,
  Sidebar,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import type { ExcalidrawElement, ExcalidrawEmbeddableElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { itemIdFromLink } from '@wb/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { de } from '../i18n/de.ts'
import { useTheme } from '../lib/theme.ts'
import { CARD_SIZE, type FakeItem, getItem, initialInbox, makeItem } from './fakeItems.ts'
import { CardActions, ItemCard } from './ItemCard.tsx'

// Spike B (PLAN.md 9, Phase 0): verifies the Excalidraw integration points before Phase 1.

const DRAG_TYPE = 'application/x-wb-item'

type WbData = { wb?: { itemId: string; kind: string } }

declare global {
  interface Window {
    __wbSpikeApi?: ExcalidrawImperativeAPI
  }
}

// Miro-like defaults (PLAN.md 5.3).
const STYLE_DEFAULTS: Partial<AppState> = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemRoundness: 'round',
  currentItemStrokeWidth: 2,
  currentItemFontSize: 20,
  currentItemFillStyle: 'solid',
}

/**
 * Builds an embeddable card element. `convertToExcalidrawElements` passes embeddables through
 * unchanged (no defaults), so we let it create a complete rectangle and change the type.
 */
export function createCardElement(item: FakeItem, x: number, y: number): ExcalidrawEmbeddableElement {
  const size = CARD_SIZE[item.kind]
  const [base] = convertToExcalidrawElements([
    {
      type: 'rectangle',
      x,
      y,
      width: size.width,
      height: size.height,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    },
  ])
  if (!base) throw new Error('could not create element')
  return {
    ...base,
    type: 'embeddable',
    link: `${window.location.origin}/i/${item.id}`,
    customData: { wb: { itemId: item.id, kind: item.kind } },
  } as ExcalidrawEmbeddableElement
}

function useFps() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let handle = 0
    const tick = (now: number) => {
      frames += 1
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0
        last = now
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [])
  return fps
}

export default function ExcalidrawSpike() {
  const navigate = useNavigate()
  const { theme, preference, setPreference } = useTheme()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [inbox, setInbox] = useState<FakeItem[]>(initialInbox)
  const [docked, setDocked] = useState(true)
  const [details, setDetails] = useState<FakeItem | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fps = useFps()

  // Spike only: lets automated checks inspect the scene from the console.
  useEffect(() => {
    window.__wbSpikeApi = api ?? undefined
  }, [api])

  const insert = useCallback(
    (elements: ExcalidrawElement[], captureUpdate: 'manual' | 'remote') => {
      if (!api) return
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
        captureUpdate: captureUpdate === 'manual' ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      })
    },
    [api],
  )

  const place = useCallback(
    (itemId: string, sceneX: number, sceneY: number) => {
      const item = getItem(itemId)
      if (!item) return
      const size = CARD_SIZE[item.kind]
      insert([createCardElement(item, sceneX - size.width / 2, sceneY - size.height / 2)], 'manual')
      setInbox((current) => current.filter((entry) => entry.id !== itemId))
    },
    [insert],
  )

  const placeAtCenter = useCallback(
    (itemId: string) => {
      if (!api) return
      const state = api.getAppState()
      const center = viewportCoordsToSceneCoords(
        { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
        state,
      )
      place(itemId, center.x, center.y)
    },
    [api, place],
  )

  // Capturing listeners intercept our own drag type before Excalidraw handles the drop (PLAN.md 5.4).
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !api) return
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      const itemId = event.dataTransfer?.getData(DRAG_TYPE)
      if (!itemId) return
      event.preventDefault()
      event.stopPropagation()
      const point = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState())
      place(itemId, point.x, point.y)
    }
    // Excalidraw uses the first double-click on an embeddable to "activate" it, so the card itself
    // never sees it. Hit-testing cards here gives "double-click opens details" and
    // "Ctrl/Cmd+click opens the link" in one step (PLAN.md 5.4).
    const cardAt = (event: MouseEvent) => {
      const state = api.getAppState()
      if (!(event.target instanceof HTMLCanvasElement)) return null
      const point = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, state)
      const hit = api
        .getSceneElements()
        .toReversed()
        .find(
          (element) =>
            element.type === 'embeddable' &&
            (element.customData as WbData | undefined)?.wb &&
            point.x >= element.x &&
            point.x <= element.x + element.width &&
            point.y >= element.y &&
            point.y <= element.y + element.height,
        )
      const itemId = (hit?.customData as WbData | undefined)?.wb?.itemId
      return itemId ? (getItem(itemId) ?? null) : null
    }
    const onDoubleClick = (event: MouseEvent) => {
      const item = cardAt(event)
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      setDetails(item)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const item = cardAt(event)
      if (!item?.url) return
      event.preventDefault()
      event.stopPropagation()
      window.open(item.url, '_blank', 'noopener,noreferrer')
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
  }, [api, place])

  const addManyCards = useCallback(() => {
    const columns = 20
    const elements = Array.from({ length: 300 }, (_, index) => {
      const item = makeItem(index)
      return createCardElement(item, (index % columns) * 380, Math.floor(index / columns) * 340 + 600)
    })
    insert(elements, 'manual')
    api?.scrollToContent(undefined, { fitToContent: true })
  }, [api, insert])

  const addSticky = useCallback(() => {
    if (!api) return
    const state = api.getAppState()
    const center = viewportCoordsToSceneCoords(
      { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
      state,
    )
    const elements = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x: center.x - 120,
        y: center.y - 90,
        width: 240,
        height: 180,
        backgroundColor: '#FFF3BF',
        strokeColor: 'transparent',
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        // The label inherits the container's (transparent) stroke colour unless set explicitly.
        label: {
          text: de.spike.sticky,
          strokeColor: '#1e1e1e',
          fontFamily: FONT_FAMILY.Nunito,
          fontSize: 20,
          textAlign: 'left',
          verticalAlign: 'top',
        },
      },
    ])
    insert(elements, 'manual')
  }, [api, insert])

  // Simulates a collaborator's edit: applied via reconcileElements + CaptureUpdateAction.NEVER,
  // so it must not end up in the local undo stack (PLAN.md 5.3).
  const simulateRemoteChange = useCallback(() => {
    if (!api) return
    const local = api.getSceneElementsIncludingDeleted()
    const target = local.find((element) => !element.isDeleted)
    if (!target) return
    const remote = {
      ...target,
      x: target.x + 60,
      version: target.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now(),
    }
    api.updateScene({
      elements: reconcileElements(local, [remote] as unknown as RemoteExcalidrawElement[], api.getAppState()),
      captureUpdate: CaptureUpdateAction.NEVER,
    })
  }, [api])

  const cardActions = useMemo(() => ({ openDetails: (itemId: string) => setDetails(getItem(itemId) ?? null) }), [])

  return (
    <CardActions.Provider value={cardActions}>
      <div ref={wrapperRef} className="fixed inset-0">
        <Excalidraw
          excalidrawAPI={setApi}
          langCode="de-DE"
          theme={theme}
          initialData={{ appState: { ...STYLE_DEFAULTS, openSidebar: { name: 'inbox' } } }}
          UIOptions={{ canvasActions: { toggleTheme: false, loadScene: false, saveToActiveFile: false } }}
          validateEmbeddable={(link) => (itemIdFromLink(link) ? true : undefined)}
          renderEmbeddable={(element, appState) => {
            const wb = (element.customData as WbData | undefined)?.wb
            if (!wb) return null
            return <ItemCard itemId={wb.itemId} zoom={appState.zoom.value} theme={appState.theme} />
          }}
          renderTopRightUI={() => (
            <Sidebar.Trigger name="inbox" title={de.spike.inbox}>
              📥 {de.spike.inbox} ({inbox.length})
            </Sidebar.Trigger>
          )}
        >
          <MainMenu>
            <MainMenu.Item onSelect={() => navigate('/')}>← {de.spike.back}</MainMenu.Item>
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Item onSelect={() => setPreference(theme === 'dark' ? 'light' : 'dark')}>
              {de.theme.label}: {de.theme[preference]}
            </MainMenu.Item>
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
          <Sidebar name="inbox" docked={docked} onDock={setDocked}>
            <Sidebar.Header>📥 {de.spike.inbox}</Sidebar.Header>
            <ul className="flex flex-col gap-2 p-3">
              {inbox.map((item) => (
                <li
                  key={item.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, item.id)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={de.spike.dragHint}
                  className="cursor-grab rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2 text-sm"
                >
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-[var(--wb-muted)]">
                    {de.kinds[item.kind]} · {item.sender} · {item.source}
                  </div>
                  <button
                    type="button"
                    onClick={() => placeAtCenter(item.id)}
                    className="mt-1 text-xs text-[var(--wb-accent)]"
                  >
                    {de.spike.placeHere}
                  </button>
                </li>
              ))}
            </ul>
          </Sidebar>
        </Excalidraw>

        <div className="pointer-events-auto absolute bottom-16 left-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2 text-sm shadow">
          <button type="button" onClick={addManyCards} className="rounded bg-[var(--wb-accent)] px-2 py-1 text-white">
            {de.spike.cards300}
          </button>
          <button type="button" onClick={addSticky} className="rounded border border-[var(--wb-border)] px-2 py-1">
            {de.spike.sticky}
          </button>
          <button
            type="button"
            onClick={simulateRemoteChange}
            title={de.spike.remoteChangeHint}
            className="rounded border border-[var(--wb-border)] px-2 py-1"
          >
            {de.spike.remoteChange}
          </button>
          <span data-testid="fps" className="font-mono text-[var(--wb-muted)]">
            {de.spike.fps} {fps}
          </span>
        </div>

        {details && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-xl bg-[var(--wb-surface)] p-4 shadow-xl">
              <h2 className="mb-1 text-lg font-semibold">{details.title}</h2>
              <p className="mb-3 text-sm text-[var(--wb-muted)]">{details.subtitle}</p>
              <div className="flex gap-2">
                {details.url && (
                  <a
                    href={details.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded bg-[var(--wb-accent)] px-3 py-1.5 text-white"
                  >
                    {de.spike.openLink}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setDetails(null)}
                  className="rounded border border-[var(--wb-border)] px-3 py-1.5"
                >
                  {de.spike.close}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CardActions.Provider>
  )
}
