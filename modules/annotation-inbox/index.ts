import { addPlugin, addServerHandler, addTypeTemplate, addVitePlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import { INBOX_DIR, INBOX_ROUTE, INBOX_STORAGE_MOUNT } from './contract'
import { annotationInbox } from './vite'

/**
 * The modules whose chunks may not be hinted to the browser: the toolbar
 * library and the mount that imports it. Matched against the manifest's keys,
 * which are source paths, so a hash change cannot age this out.
 */
const GATED_CHUNK = /agentation-vue|annotation-inbox\/(?:modules\/annotation-inbox\/)?runtime\/mount/

/**
 * Registers the annotation toolbar, its server routes and its storage mount.
 *
 * **Why a module rather than a plugin in the layer's `app/plugins/`.** A
 * module decides what exists for a build at all, rather than contributing a
 * plugin entry whose body dead-branch folding may or may not remove. That was
 * how this layer kept itself out of production entirely; it now ships on
 * purpose, and the same control is what keeps it out of a *test* build, where
 * a toolbar nobody clicks is only a source of flakes.
 *
 * **What "ships" means here.** The routes exist in every build and refuse
 * everyone who is neither a token holder nor someone the host's
 * `annotation-inbox:authorize` hook vouches for. The toolbar's own code stays
 * in a lazily imported chunk that `runtime/mount.ts` fetches only after
 * `/__annotations/access` has said yes — so an ordinary reader downloads
 * neither the toolbar nor the PolyForm Shield library behind it.
 *
 * **The tracer is not registered here.** Nuxt DevTools already adds
 * `vite-plugin-vue-tracer` on the client whenever devtools are enabled with
 * their default `componentInspector`, and a second registration would be
 * redundant. The consequence is worth knowing: with `devtools: { enabled:
 * false }` or `componentInspector: false`, annotations still name every
 * component and its SFC, but lose the final `file:line:column` segment — and
 * a note without one falls back to naming the route it was made on, which is
 * also what a production build gives.
 */
export default defineNuxtModule({
  meta: { name: 'annotation-inbox' },

  setup(_options, nuxt) {
    // `@nuxt/test-utils` sets this. Everything else — dev, preview, production
    // — gets the routes.
    if (nuxt.options.test) return

    const { resolve } = createResolver(import.meta.url)

    // Empty by default, which means "no agent can authenticate": a token that
    // defaults to something is a token somebody forgets to change.
    nuxt.options.runtimeConfig.annotationInbox = {
      token: '',
      ...(nuxt.options.runtimeConfig.annotationInbox as Record<string, unknown> | undefined),
    }

    // `??=`, so a host that mounts a database here keeps it. The fallback base
    // is relative to the server's working directory: the repo root under
    // `nuxt dev`, the image's app directory in a container.
    nuxt.options.nitro.storage ??= {}
    nuxt.options.nitro.storage[INBOX_STORAGE_MOUNT] ??= { driver: 'fs', base: `./${INBOX_DIR}` }

    // Build-time configuration only — the workspace root define and the
    // optimiser exclusion. Under Nuxt the endpoint is Nitro's, below, which is
    // the one that also exists in a build.
    addVitePlugin(annotationInbox())

    // Two routes because h3 matches the collection and its children
    // separately; both land on the same handler, which branches on the path.
    addServerHandler({ route: INBOX_ROUTE, handler: resolve('./runtime/server/handler') })
    addServerHandler({ route: `${INBOX_ROUTE}/**`, handler: resolve('./runtime/server/handler') })

    addPlugin({ src: resolve('./runtime/plugin.client'), mode: 'client' })

    // A gate the browser walks around by itself otherwise. Nuxt turns every
    // dynamic import of a plugin chunk into `<link rel="prefetch">`, so a
    // reader who is refused still downloads the toolbar — measured on
    // 2026-09-23: `/` on a production build fetched both library chunks before
    // `/access` had answered. The gate is about what leaves the server, so the
    // hint has to go.
    nuxt.hook('build:manifest', (manifest) => {
      for (const [id, entry] of Object.entries(manifest)) {
        if (!GATED_CHUNK.test(id)) continue
        entry.prefetch = false
        entry.preload = false
      }
    })

    // The host implements the hook, so the host needs its type. Declared from
    // the layer rather than documented in a README, because a hook whose
    // payload a consumer has to guess is a hook they implement wrongly once.
    addTypeTemplate({
      filename: 'types/annotation-inbox.d.ts',
      getContents: () => `import type { H3Event } from 'h3'

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Asked once per inbox request that carried no agent token. Set
     * \`decision.allowed = true\` to let the request in as a reviewer.
     */
    'annotation-inbox:authorize': (decision: { event: H3Event, allowed: boolean }) => void | Promise<void>
  }
}

declare module 'nuxt/schema' {
  interface RuntimeConfig {
    annotationInbox: { token: string }
  }
}

export {}
`,
    }, { nuxt: true, nitro: true })
  },
})
