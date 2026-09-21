/**
 * What the browser half and the server half have to agree on.
 *
 * Two halves of one feature that never share a module graph — one is bundled
 * into the page, the other runs in the dev server's Node process — and the
 * only thing tying them together is a route string, a directory and the shape
 * of one JSON body. Written down once so a rename cannot break the pair
 * silently: a drifting route is a `404` nobody looks at, and a drifting
 * payload shape is a file with a missing field.
 *
 * Neither this file nor `vite.ts` may name `agentation-vue`. The toolbar's
 * dependency is allowed on exactly one file in the repo
 * (`test/unit/annotation-toolbar.spec.ts`), and the types below are the
 * *inbox's* view of an annotation, not the library's: every field the files on
 * disk carry, and nothing that would make a dev-server module import a
 * PolyForm Shield package.
 */

/**
 * Where the toolbar mirrors its session to. Prefixed `__boje` the way Vite
 * prefixes its own internals: this is a dev-server route, not an app route,
 * and the prefix keeps it from ever colliding with a page.
 */
export const INBOX_ROUTE = '/__boje/annotations'

/**
 * Relative to the workspace root. `.data/` is Nuxt's conventional local-data
 * directory and is already gitignored here, which is the right lifetime: the
 * files mirror a browser session, and a browser session is not history worth
 * committing. To keep annotations beside tickets instead, change this one
 * constant.
 */
export const INBOX_DIR = '.data/annotations'

/**
 * The single `sessionStorage` key the toolbar library writes its whole store
 * under — every origin's annotations in one JSON object, keyed by origin.
 * The client half watches writes to this key and forwards them.
 */
export const AGENTATION_STORAGE_KEY = 'agentation-vue-annotations'

/**
 * The toolbar package, named here because the dev server has to keep Vite's
 * dependency optimiser away from it.
 *
 * The library ships `AgentationVue.vue` as a real SFC inside `dist/`, and
 * esbuild cannot compile that — so the optimiser prebundles everything *but*
 * the component and leaves the `.vue` file to `@vitejs/plugin-vue`, which
 * resolves its relative imports on its own. The result is two live copies of
 * the library's module-level state: the prebundled one, which is what the
 * mount's dynamic import hands back, and the component's, which is the one
 * actually rendering. Hooks set on the first are silently ignored — measured:
 * annotations kept the library's default component chain and never reached
 * the inbox on change. Excluding the package from optimisation collapses the
 * two back into one instance, at the price of a handful of extra module
 * requests in a dev server.
 */
export const TOOLBAR_PACKAGE = 'agentation-vue'

/**
 * One annotation as it is serialised into the store. Only the fields the inbox
 * itself reads are named; the rest (`boundingBox`, `nearbyText`,
 * `computedStyles`, …) travel through untouched into the JSON file, which is
 * why this is not an exhaustive mirror of the library's `Annotation`.
 */
export interface InboxAnnotation {
  id: string
  comment: string
  elementPath: string
  vueComponents?: string
  url?: string
  timestamp: number
}

/**
 * What the toolbar POSTs on every change: the whole session for one origin,
 * replacing whatever was there. Not a diff — the store the client reads is
 * itself the whole truth, and a replace cannot desynchronise.
 */
export interface InboxPayload {
  /** `location.origin`, e.g. `http://localhost:3040`. Names the file. */
  origin: string
  /** `location.href` at the time of the change. */
  url: string
  annotations: InboxAnnotation[]
  /** The same markdown the toolbar's Copy button produces. */
  markdown: string
}

/**
 * What lands in `.data/annotations/<host>-<port>.json`. The markdown is not in
 * it: that is the sibling `.md`, so an agent can `cat` one file and read it.
 */
export interface InboxRecord extends Omit<InboxPayload, 'markdown'> {
  /** ISO 8601, written by the server — the client's clock is not the record's. */
  updatedAt: string
}
