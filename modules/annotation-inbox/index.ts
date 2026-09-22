import { addPlugin, addVitePlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import { annotationInbox } from './vite'

/**
 * Registers the annotation toolbar and its inbox — and, outside a dev server,
 * registers nothing at all.
 *
 * **Why a module rather than a plugin in the layer's `app/plugins/`.** A
 * scanned plugin file is an entry in Nuxt's plugin array even when its body
 * has been eliminated by dead-branch folding, and that alone is enough to
 * move a chunk hash: measured, the production bundle stopped being
 * byte-identical to one built before the toolbar existed. A module decides
 * *whether the file exists* for the build at all, which is the stronger
 * statement and the one a layer dropped into someone else's project should
 * be making.
 *
 * Two locks, and they fail independently:
 *
 *  1. The guard below. Outside `nuxt dev` — and under `@nuxt/test-utils`,
 *     which sets `nuxt.options.test` — nothing is registered: no plugin in
 *     the app graph, no Vite plugin, no path from the app to
 *     `agentation-vue`. It is the same gate Nuxt DevTools uses for the very
 *     tracer this layer reads.
 *  2. `apply: 'serve'` inside `annotationInbox()`, so even a build that did
 *     register the Vite plugin would not carry the endpoint.
 *
 * **The tracer is not registered here.** Nuxt DevTools already adds
 * `vite-plugin-vue-tracer` on the client whenever devtools are enabled with
 * their default `componentInspector`, and a second registration would be
 * redundant. The consequence is worth knowing: with `devtools: { enabled:
 * false }` or `componentInspector: false`, annotations still name every
 * component and its SFC, but lose the final `file:line:column` segment.
 * Adding `VueTracer()` to the `addVitePlugin` call below restores it — the
 * tracer skips files it has already instrumented, so registering it twice is
 * harmless.
 */
export default defineNuxtModule({
  meta: { name: 'annotation-inbox' },

  setup(_options, nuxt) {
    if (!nuxt.options.dev || nuxt.options.test) return

    const { resolve } = createResolver(import.meta.url)

    addVitePlugin(annotationInbox())
    addPlugin({ src: resolve('./runtime/plugin.client'), mode: 'client' })
  },
})
