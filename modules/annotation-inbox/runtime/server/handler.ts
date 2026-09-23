import {
  defineEventHandler,
  getHeader,
  getRequestURL,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
// `nitropack/runtime` rather than `#imports`: this file is compiled into the
// Nitro server, whose auto-import alias is not the app's.
import { useNitroApp, useRuntimeConfig, useStorage } from 'nitropack/runtime'
import { INBOX_ROUTE, INBOX_STORAGE_MOUNT } from '../../contract'
import { bearerToken, createInbox, handleInboxRequest } from '../../inbox'
import type { InboxRole } from '../../contract'
import type { InboxRequest } from '../../inbox'

/**
 * The inbox on the application server — the half that exists in a deployed
 * build, where there is no Vite dev server to answer `/__annotations`.
 *
 * It decides nothing about annotations: `inbox.ts` owns the route table, the
 * storage layout and the validation, and this file only translates an `H3Event`
 * into that and back. The one thing it does own is *who is allowed in*, because
 * that is the only question whose answer differs between a developer's laptop
 * and a public origin.
 *
 * Three answers, in order, and the order is the point:
 *
 *  1. A bearer token equal to the configured one — an agent, which is how a
 *     process with no browser session reaches the inbox from outside.
 *  2. `import.meta.dev` — a dev server is somebody's own machine, so it never
 *     asks anyone. Without this a developer would have to configure a token to
 *     annotate their own app.
 *  3. The host's `annotation-inbox:authorize` hook, which is the seam an
 *     application uses to say "this request carries a session I trust". The
 *     package cannot know what that means; it can only ask.
 *
 * Anything else is refused — except `/access`, which answers `{ allowed }`
 * precisely so an ordinary reader's page load is not a failed request.
 */
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const path = url.pathname.slice(INBOX_ROUTE.length).replace(/\/$/, '')

  const request: InboxRequest = {
    method: event.method,
    path,
    query: url.searchParams,
    authorization: getHeader(event, 'authorization'),
    body: async () => (await readRawBody(event, 'utf8')) ?? '',
  }

  const authorize = async (candidate: InboxRequest): Promise<InboxRole | undefined> => {
    const token = useRuntimeConfig(event).annotationInbox?.token
    if (token && bearerToken(candidate.authorization) === token) return 'agent'
    if (import.meta.dev) return 'reviewer'

    const decision = { event, allowed: false }
    await useNitroApp().hooks.callHook('annotation-inbox:authorize', decision)
    return decision.allowed ? 'reviewer' : undefined
  }

  // Per request: unstorage's mount lookup is a map read, and holding an inbox
  // across requests would pin a mount the host may still be installing.
  const inbox = createInbox(useStorage(INBOX_STORAGE_MOUNT))
  const response = await handleInboxRequest(inbox, request, authorize)

  setResponseStatus(event, response.status)
  for (const [name, value] of Object.entries(response.headers)) {
    setResponseHeader(event, name, value)
  }
  return response.status === 204 ? null : response.body
})
