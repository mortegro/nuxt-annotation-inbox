import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { searchForWorkspaceRoot } from 'vite'
// With its extension, because `.storybook/main.ts` imports this file and
// Storybook's own bundler warns about extensionless imports in that graph —
// the same thing Vite's native config loader asks of `vitest.config.ts`.
import { INBOX_DIR, INBOX_ROUTE, TOOLBAR_PACKAGE } from './contract.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { InboxPayload, InboxRecord } from './contract.ts'

/**
 * The inbox's server half: a dev-server route that writes annotations into the
 * working copy.
 *
 * **Why a Vite plugin and not a Nitro route.** The same endpoint has to exist
 * under `nuxt dev` and under `storybook dev`, and the only thing those two
 * harnesses have in common is Vite. Nuxt forwards any request whose path is
 * registered on `viteServer.middlewares` to Vite before Nitro answers it
 * (`@nuxt/vite-builder`), so one plugin serves both. A Nitro route would serve
 * the app and leave Storybook without an inbox, and a second implementation
 * for Storybook is the drift `contract.ts` exists to prevent.
 *
 * **`apply: 'serve'` is a build guarantee, not a nicety.** It is the reason no
 * production build and no `storybook build` can contain this route: the plugin
 * is not in the build's plugin list at all. The client half has its own guard
 * (`import.meta.env.DEV`); this is the other end of the same rule.
 */

/**
 * The handler, separated from the plugin so it can be tested against a plain
 * `http.createServer` on a temp directory — the contract this file is really
 * making is about files on disk, and asserting it through a full Vite dev
 * server would test Vite.
 */
export function createInboxHandler(dir: string) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(readInbox(dir), null, 2))
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('annotation inbox: GET or POST')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)

    let payload: InboxPayload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as InboxPayload
    } catch (error) {
      res.statusCode = 400
      res.end(`annotation inbox: body is not JSON (${String(error)})`)
      return
    }

    const slug = originSlug(payload?.origin)
    if (!slug || !Array.isArray(payload.annotations) || typeof payload.markdown !== 'string') {
      res.statusCode = 400
      res.end('annotation inbox: expected { origin: URL, annotations: [], markdown: "" }')
      return
    }

    // An empty session is no file, mirroring the library's own store: it
    // deletes an origin's key rather than storing `[]`. Otherwise a cleared
    // toolbar would leave a file saying nothing, and "is there a file" would
    // stop being the cheap question it is.
    if (payload.annotations.length === 0) {
      rmSync(join(dir, `${slug}.json`), { force: true })
      rmSync(join(dir, `${slug}.md`), { force: true })
      res.statusCode = 204
      res.end()
      return
    }

    const record: InboxRecord = {
      origin: payload.origin,
      url: payload.url,
      annotations: payload.annotations,
      updatedAt: new Date().toISOString(),
    }

    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${slug}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    writeFileSync(join(dir, `${slug}.md`), payload.markdown, 'utf8')

    res.statusCode = 204
    res.end()
  }
}

/**
 * `http://localhost:3040` → `localhost-3040`. The host, because that is what
 * distinguishes one harness from another, and a colon is a filename a shell
 * has to quote. Returns `undefined` for anything that is not a URL, which is
 * the validation the `POST` branch leans on.
 */
function originSlug(origin: unknown): string | undefined {
  if (typeof origin !== 'string') return undefined
  try {
    return new URL(origin).host.replace(':', '-')
  } catch {
    return undefined
  }
}

/** Every origin's record, keyed by origin — the shape `GET` answers with. */
function readInbox(dir: string): Record<string, InboxRecord> {
  let files: string[]
  try {
    files = readdirSync(dir).filter(file => file.endsWith('.json'))
  } catch {
    // No directory means no annotations, not an error: the inbox is created by
    // the first note and removed again by the last deletion.
    return {}
  }

  const inbox: Record<string, InboxRecord> = {}
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(join(dir, file), 'utf8')) as InboxRecord
      if (record?.origin) inbox[record.origin] = record
    } catch {
      // A half-written or hand-edited file is skipped rather than fatal: this
      // endpoint is how an agent reads the *other* origins too.
    }
  }
  return inbox
}

export function annotationInbox(): Plugin {
  // The same call `vite-plugin-vue-tracer` makes for the paths it records, so
  // the directory this writes into and the paths inside the files it writes
  // are relative to one and the same root.
  const root = searchForWorkspaceRoot(process.cwd())
  const dir = join(root, INBOX_DIR)

  return {
    name: 'annotation-inbox',
    apply: 'serve',

    // Two things the dev server has to be told, both of them about identity:
    //
    //  - `__ANNOTATION_INBOX_ROOT__`: the client half turns the absolute SFC
    //    paths in `__file` into workspace-relative ones, and only the server
    //    knows where the workspace root is. A compile-time substitution, so
    //    the browser never learns a path it was not already going to print.
    //  - `optimizeDeps.exclude`: one copy of the toolbar library, not two.
    //    See `TOOLBAR_PACKAGE` in `contract.ts` for what the second copy
    //    silently breaks.
    config: () => ({
      define: { __ANNOTATION_INBOX_ROOT__: JSON.stringify(root) },
      optimizeDeps: { exclude: [TOOLBAR_PACKAGE] },
    }),

    configureServer(server) {
      const handler = createInboxHandler(dir)
      server.middlewares.use(INBOX_ROUTE, (req, res) => {
        handler(req, res).catch((error: unknown) => {
          res.statusCode = 500
          res.end(String(error))
        })
      })
      // Printed once per dev server, because an inbox nobody knows the path of
      // is a feature nobody uses.
      server.config.logger.info(`annotation inbox: ${INBOX_ROUTE} → ${INBOX_DIR}/`)
    },
  }
}
