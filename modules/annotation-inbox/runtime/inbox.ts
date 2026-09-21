import { AGENTATION_STORAGE_KEY, INBOX_ROUTE } from '../contract'
import type { InboxAnnotation, InboxPayload } from '../contract'

/**
 * Everything the toolbar has to be *told* so its notes reach the repo instead
 * of dying with the tab: where to mirror its store, and what a component chain
 * should say.
 *
 * The library exports three hooks and this file is nothing but their
 * arguments — a storage adapter, a component detector, and its own markdown
 * formatter used on the way out. Deliberately no fork and no patch: a fork of
 * a PolyForm Shield package is a fork nobody upgrades.
 *
 * The package is never named here. It is handed in (`InboxDeps`) by the one
 * file allowed to import it, `mount.ts`, which is what keeps a second importer
 * from appearing (`test/unit/annotation-toolbar.spec.ts`).
 */

/**
 * The workspace root, substituted as a literal by the inbox's Vite plugin.
 * Absent when something else loads this file, hence the `typeof` guard at the
 * one place it is read: without a root, SFC paths stay absolute rather than
 * the whole detector failing.
 */
declare const __BOJE_WORKSPACE_ROOT__: string

/** One component instance, as much of it as a chain segment needs. */
interface ChainInstance {
  type?: { name?: string, __name?: string, __file?: string }
  parent?: ChainInstance | null
}

export interface InboxDeps {
  setAnnotationStorage(adapter: { getItem(key: string): string | null, setItem(key: string, value: string): void }): void
  setVueDetector(detector: (el: Element) => string | undefined): void
  formatAnnotations(annotations: InboxAnnotation[], detail: 'standard', pageUrl: string): string
  findTraceFromElement(el?: Element | null): { fullpath: string } | undefined
}

export function installAnnotationInbox(deps: InboxDeps): void {
  /**
   * One POST per change, carrying the whole session for this origin.
   *
   * Fire and forget. The `sessionStorage` write the library just made is the
   * authoritative copy as far as the toolbar is concerned; the file is a
   * mirror, and a mirror that fails to update must not take the toolbar down
   * with it — a developer annotating against a dev server that has just
   * restarted should notice nothing.
   */
  function post(raw: string): void {
    let annotations: InboxAnnotation[] = []
    try {
      // The library keys its store by origin (`domain-port` scope), so this
      // tab's notes are one entry of an object that may also hold another
      // origin's from an earlier visit.
      annotations = (JSON.parse(raw) as Record<string, InboxAnnotation[]>)[location.origin] ?? []
    } catch {
      annotations = []
    }

    const payload: InboxPayload = {
      origin: location.origin,
      url: location.href,
      annotations,
      // The same text the Copy button produces, so the file an agent reads and
      // the paste a human makes are the same artefact. Not computed for an
      // empty session: that POST only tells the server to delete the files.
      markdown: annotations.length > 0 ? deps.formatAnnotations(annotations, 'standard', location.href) : '',
    }

    void fetch(INBOX_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      console.warn(`[annotation-inbox] could not reach ${INBOX_ROUTE}; the annotation is still in this tab`)
    })
  }

  deps.setAnnotationStorage({
    getItem: key => sessionStorage.getItem(key),
    setItem(key, value) {
      sessionStorage.setItem(key, value)
      if (key === AGENTATION_STORAGE_KEY) post(value)
    },
  })

  // Once on load, before anything is annotated. Two things depend on it: a
  // reloaded tab re-publishes notes the server may have lost to a restart, and
  // a *fresh* tab publishes its empty session, which deletes the file left by
  // the session before it. The file therefore mirrors the last active tab on
  // an origin — one tab per origin is the rule, and the README says so.
  post(sessionStorage.getItem(AGENTATION_STORAGE_KEY) ?? '{}')

  deps.setVueDetector((el) => {
    const segments: string[] = []
    const root = typeof __BOJE_WORKSPACE_ROOT__ === 'string' ? __BOJE_WORKSPACE_ROOT__ : ''

    let instance = instanceFor(el)
    for (let depth = 0; instance && depth < 20; depth++) {
      const type = instance.type
      // `__file` is absolute in a Vite dev server (`@vitejs/plugin-vue` writes
      // the resolved id) — which is a path no agent can paste, so it is made
      // repo-relative here rather than at the reading end.
      const absolute = type?.__file ?? ''
      const file = root && absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute
      const name = type?.name ?? type?.__name ?? file.split('/').pop()?.replace(/\.vue$/, '') ?? ''

      // `_`-prefixed names are the library's own filter for the anonymous
      // wrappers a framework stacks up; they name no file anybody can open.
      if (name && !name.startsWith('_')) segments.unshift(file ? `${name} (${file})` : name)
      instance = instance.parent ?? undefined
    }

    // The last segment is the point of the whole line: not which component the
    // element belongs to, but where in that component's template it is
    // written. `vite-plugin-vue-tracer` recorded it against the same workspace
    // root, so it is already repo-relative.
    const trace = deps.findTraceFromElement(el)?.fullpath
    if (trace) segments.push(trace)

    return segments.length > 0 ? segments.join(' > ') : undefined
  })
}

/**
 * The component instance an element belongs to — its own, or the nearest
 * ancestor's, because plain DOM inside a template carries no instance of its
 * own. Stops at `<body>`, the same bound the library's default detector uses.
 */
function instanceFor(el: Element): ChainInstance | undefined {
  let current: Element | null = el
  while (current && current !== document.body) {
    const instance = (current as Element & { __vueParentComponent?: ChainInstance }).__vueParentComponent
    if (instance) return instance
    current = current.parentElement
  }
  return undefined
}
