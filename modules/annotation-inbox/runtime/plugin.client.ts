import { defineNuxtPlugin } from '#app'
import { mountAnnotationToolbar } from './mount'

/**
 * The Nuxt end of the shared mount. Registered by the layer's module and only
 * under `nuxt dev`, so this file is never in a production plugin graph — the
 * `.client` suffix and `mode: 'client'` keep it out of Nitro as well, because
 * the mount touches `document` and the toolbar reads `sessionStorage`.
 */
export default defineNuxtPlugin(() => {
  mountAnnotationToolbar()
})
