// `defineNuxtConfig` is imported rather than taken from Nuxt's auto-imports:
// those only exist inside a project Nuxt has prepared, and this file has to
// typecheck on its own as part of a published package.
import { defineNuxtConfig } from 'nuxt/config'

/**
 * The annotation-inbox layer contributes *nothing* to the app's configuration,
 * on purpose.
 *
 * A layer is how Nuxt 4 makes a directory reusable — drop it into another
 * project's `layers/` and it is picked up with no line of config — but every
 * option a layer merges in is an option the consuming project did not ask for
 * and has to un-merge. Everything this layer does is instead the module in
 * `modules/annotation-inbox/`, which Nuxt scans out of `layers/ * /modules/`
 * and which registers itself only under `nuxt dev`. Outside a dev server the
 * layer is inert: no plugin, no Vite plugin, no dependency on a code path.
 *
 * See `README.md` for the reuse contract.
 */
export default defineNuxtConfig({
  $meta: { name: 'annotation-inbox' },
})
