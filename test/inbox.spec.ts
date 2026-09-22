import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createInboxHandler } from '../modules/annotation-inbox/vite'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { InboxPayload, InboxRecord } from '../modules/annotation-inbox/contract'

/**
 * The inbox's contract is files: a human annotates, and an agent that never
 * touched a browser finds the notes on disk. Everything between those two —
 * the toolbar, the fetch, the middleware — is machinery, and this spec asserts
 * only what a reader of the working copy can observe.
 *
 * Driven through a real `http.createServer` on a temp directory rather than a
 * Vite dev server: the handler is the part that decides what a file is called,
 * when it exists and when it stops existing, and standing up Vite to ask that
 * would be testing Vite. `.data/annotations/` in the repo stays untouched,
 * which matters — the suite runs while somebody may be annotating.
 */

const dir = mkdtempSync(join(tmpdir(), 'annotation-inbox-'))
let server: Server
let origin: string

/** A payload of the shape the toolbar posts, with as much filled in as the files show. */
function payload(from: string, comments: string[]): InboxPayload {
  return {
    origin: from,
    url: `${from}/walk`,
    annotations: comments.map((comment, index) => ({
      id: String(index + 1),
      comment,
      elementPath: 'div#__nuxt > button.primary',
      vueComponents: 'WalkFrame (app/components/layout/WalkFrame.vue) > app/components/layout/WalkFrame.vue:42:5',
      url: `${from}/walk`,
      timestamp: 1_700_000_000_000 + index,
    })),
    markdown: `## Feedback — ${from.replace(/^https?:\/\//, '')}/walk\n\n${comments.join('\n')}\n`,
  }
}

async function post(body: InboxPayload): Promise<Response> {
  return fetch(`${origin}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  const handle = createInboxHandler(dir)
  server = createServer((req, res) => {
    void handle(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

describe('the annotation inbox', () => {
  it('writes one markdown and one json file per origin', async () => {
    const sent = payload('http://localhost:3040', ['Weiter-Button sitzt zu tief', 'Abstand hier stimmt nicht'])
    const response = await post(sent)

    expect(response.status).toBe(204)

    // The name is the origin's host with its colon flattened, because that is
    // the one part of an origin that distinguishes two harnesses, and a colon
    // in a filename is a shell quoting problem for whoever reads it.
    const record = JSON.parse(readFileSync(join(dir, 'localhost-3040.json'), 'utf8')) as InboxRecord

    expect(record.origin).toBe('http://localhost:3040')
    expect(record.annotations.map(annotation => annotation.comment)).toEqual([
      'Weiter-Button sitzt zu tief',
      'Abstand hier stimmt nicht',
    ])
    // Written by the server, not the browser: the timestamp that says how
    // stale a note is has to come from the clock the reader shares.
    expect(new Date(record.updatedAt).toISOString()).toBe(record.updatedAt)

    // Verbatim, so `cat` of the markdown is exactly what the toolbar's Copy
    // button would have put on the clipboard.
    expect(readFileSync(join(dir, 'localhost-3040.md'), 'utf8')).toBe(sent.markdown)
  })

  it('removes both files when the last annotation is deleted', async () => {
    await post(payload('http://localhost:3040', ['wird gleich gelöscht']))
    const response = await post(payload('http://localhost:3040', []))

    expect(response.status).toBe(204)
    // An empty session is no file. "Is there a file" is the cheapest question
    // an agent can ask, and a file saying nothing would break it.
    expect(existsSync(join(dir, 'localhost-3040.json'))).toBe(false)
    expect(existsSync(join(dir, 'localhost-3040.md'))).toBe(false)
  })

  it('serves every origin at once, each with its own annotations', async () => {
    await post(payload('http://localhost:3040', ['aus dem Dev-Server']))
    await post(payload('http://localhost:6011', ['aus Storybook']))

    const inbox = await (await fetch(`${origin}/`)).json() as Record<string, InboxRecord>

    // Two harnesses, two sessions, one request: an agent asks the dev server
    // it can reach and learns about the one it cannot.
    expect(Object.keys(inbox).sort()).toEqual(['http://localhost:3040', 'http://localhost:6011'])
    expect(inbox['http://localhost:3040']?.annotations[0]?.comment).toBe('aus dem Dev-Server')
    expect(inbox['http://localhost:6011']?.annotations[0]?.comment).toBe('aus Storybook')
  })

  it('refuses a body that names no origin', async () => {
    const response = await fetch(`${origin}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'not a url', url: '', annotations: [], markdown: '' }),
    })

    // A 400 rather than a file called `not a url.json`: the origin is the file
    // name, so an origin that is not one has nowhere to land.
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('origin')
  })
})
