# annotation-inbox

A Nuxt 4 layer that turns "this button sits too low" into a file in your working copy, with
the line of the SFC that draws the button.

## What it does

Under `nuxt dev` — and, behind an access check, wherever the host allows it — a small
toolbar hangs off `<body>`. A human clicks an element, writes a comment, and the note is
mirrored to the server, which keeps every note as its own entry in an
[unstorage](https://unstorage.unjs.io) store. By default that store is a directory:

```
.data/annotations/items/<sessionId>-<n>.json   one note, with its target and its status
.data/annotations/sessions/<sessionId>.json    which notes one browser tab owns
.data/annotations/markdown/<sessionId>.md      the text the toolbar's Copy button produces
```

An agent reads them over HTTP — `GET /__annotations?format=markdown` — acts, and answers
each note with `POST /__annotations/resolve`. No browser extension, no clipboard step, and
nothing that only works in Chromium. The transport is plain HTTP, which is also why
wrapping it in an MCP server is a page of code rather than a feature this package has to
ship — see *An MCP server over the inbox*.

One entry per note rather than one blob per tab is deliberate: a host that mounts a
database under the store (see *Storage*) then holds one row per annotation, so "what is
still open, and what was rejected with what reason" is a query.

Each annotation names the element three ways, and the third is the useful one:

```
- **Path:** div#__nuxt > div.phone > … > div.guide-grid > button.guide-card > img.guide-img
- **Components:** nuxt-root > NuxtLayout > WalkFrame (app/components/layout/WalkFrame.vue) > GuidePicker (app/components/guide/GuidePicker.vue) > app/components/guide/GuidePicker.vue:42:5
```

Every component in the chain carries its SFC path relative to the workspace root, and the
final segment is the annotated element's own position in the template it is written in.
Open that first.

**A tab is a session.** Each tab gets an id that lives as long as the tab, and publishes
its whole session on load and on every change, so two tabs never overwrite each other and
a tab that clears its notes clears only its own. A resolution is sticky: a note an agent
closed stays closed when the tab republishes it, and vanishes for good once the tab stops
sending it. The notes are as ephemeral as the sessions they were made in, which is why
`.data/` is gitignored — a host that wants them to outlive a container mounts a database
instead.

## Install

```bash
npm i -D nuxt-layer-annotation-inbox            # once it is on a registry
npm i -D github:mortegro/nuxt-annotation-inbox#v0.1.0   # straight from the tag
```

```ts
// nuxt.config.ts
extends: ['nuxt-layer-annotation-inbox']
```

Add `.data/` to `.gitignore` if it is not there already. That is the whole Nuxt side: the
layer's module registers the toolbar plugin, the Nitro routes and a storage mount by
itself. It steps aside only under `@nuxt/test-utils` (`nuxt.options.test`), so a test run
neither serves the routes nor mounts a store.

Two things about installing it **from GitHub**, both measured rather than guessed:

- **npm 11 or newer.** npm 10.9.8 cannot prepare a git dependency that builds itself:
  `npm install` fails with `git dep preparation failed … Cannot read properties of null
  (reading 'edgesOut')`, reproducible in an empty directory with this dependency alone.
  `npm i -g npm@11` fixes it; declare the floor in your `engines.npm`.
- **No `--ignore-scripts`.** The package's `prepare` script is what builds `dist/vite.mjs`,
  the `./vite` export Storybook loads. Skipping scripts installs a package whose
  `.storybook/main.ts` import resolves to nothing.

Requirements: Nuxt 4, and DevTools left enabled with their default `componentInspector` —
that is what registers `vite-plugin-vue-tracer`, and the tracer is what supplies the
`file:line:column` segment. With devtools off, annotations still name every component and
its file; they just stop naming the line, and fall back to naming the route the note was
made on. Adding `VueTracer()` to the module's `addVitePlugin` call brings it back (the
tracer skips already-instrumented files, so a double registration is harmless).

**Copying the directory** into your project's `layers/` still works and is the fallback for
a project that cannot take the dependency: Nuxt 4 extends every directory under
`~~/layers/` automatically, so no `extends` line is needed in that mode. Run your package
manager afterwards so the layer's own dependencies (`agentation-vue`,
`vite-plugin-vue-tracer`, `unstorage`) are installed — with npm workspaces,
`"workspaces": ["layers/*"]` in the root manifest is enough. Now that the package is
published this is the fallback rather than the recommendation, because a copy does not get
updates.

### Check the install

```bash
npm run dev
curl -s localhost:3000/__annotations          # {"status":"open","items":[]}
curl -s localhost:3000/__annotations/access   # {"allowed":true}
```

Then annotate something in the browser, see it in `?format=markdown`, resolve it, and watch
the marker leave the tab within about ten seconds. If `/__annotations` answers with your
app's HTML instead of JSON, the route is not registered — check the `extends` line.

## Storybook

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by
hand — two lines in `.storybook/main.ts`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from 'nuxt-layer-annotation-inbox/vite'

// in viteFinal's mergeConfig:
plugins: [vue(), ...(process.env.VITEST ? [] : [VueTracer(), annotationInbox({ endpoint: true })])],
```

and one in `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from 'nuxt-layer-annotation-inbox/mount'

setup(() => mountAnnotationToolbar())
```

`setup()` rather than a decorator: it is the one hook only Storybook's own renderer
reaches, so importing the preview from Vitest registers the toolbar without ever mounting
it. The `VITEST` gate keeps the endpoint and the instrumentation out of a browser-mode
Vitest project that loads `main.ts` through `@storybook/addon-vitest`.

`{ endpoint: true }` is what makes this Vite server *answer* `/__annotations` rather than
only configure the client half. Storybook has no Nitro, so it is the one harness that has
to ask for it; under `nuxt dev` the Nitro route already exists and the flag stays off.

The two subpaths are deliberately different in kind. `./vite` is built to `dist/vite.mjs`,
because it is loaded by Node — and Node will not type-strip TypeScript that lives under
`node_modules`. `./mount` is the raw `.ts` source, because its consumer is a Vite pipeline
that compiles it anyway, and shipping it precompiled would put the access gate's dynamic
imports behind a build boundary where the consumer's bundler can no longer split them into
their own chunk.

Storybook is its own origin and its tabs are their own sessions, but it reads the same
store as the Nuxt server beside it, so either port lists every note.

## Deploying it

The inbox exists in a production build too — annotating a deployed preview is the point —
and there it has to know who may annotate. Two independent doors, in this order:

1. **An agent token.** `NUXT_ANNOTATION_INBOX_TOKEN` maps to
   `runtimeConfig.annotationInbox.token` and is matched against
   `Authorization: Bearer <token>`. It is empty by default, which means "no agent can
   authenticate": a token that defaults to something is a token somebody forgets to change.
2. **A reviewer session**, decided by the host through a Nitro hook. The package cannot
   know what a trusted session is in your application, so it asks:

```ts
// server/plugins/annotation-inbox.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('annotation-inbox:authorize', async (decision) => {
    try {
      decision.allowed = await yourOwnSessionCheck(decision.event)
    }
    catch {
      decision.allowed = false   // see below: this runs on ordinary page loads
    }
  })
})
```

The hook's type arrives with the layer (`addTypeTemplate` writes it into
`.nuxt/types/`), so `decision.event` and `decision.allowed` are typed without you
declaring anything.

**Swallow your own errors in that hook.** It also runs for `/__annotations/access`, which
every page load probes, so an unreachable auth backend must produce
`200 {"allowed": false}` and not a `500` on a reader's page.

Under `nuxt dev` neither door is needed: a dev server is somebody's own machine and
answers `reviewer` to everyone. Without that rule a developer would have to configure a
token to annotate their own app.

Everything else is refused with `401 annotation inbox: unauthorized` — except
`/__annotations/access`, which always answers `{ allowed }` with a `200`, because a
refusal there would be a failed request on every reader's page load.

### In a container

- The server's working directory is the store's base, so `.data/annotations` has to exist
  and be writable by the user the image runs as. Create it in the Dockerfile and `chown` it;
  mount a volume over it if the notes should outlive the container.
- Pass `NUXT_ANNOTATION_INBOX_TOKEN` in; without it no agent can read the inbox from
  outside, which is the safe default but rarely the one you want in a review deployment.
- If the image installs this package **from GitHub**, the builder stage needs `git` and
  npm 11, and must not run with `--ignore-scripts` (see *Install*).

### Check the deployment

```bash
curl -s localhost:<port>/__annotations/access                       # {"allowed":false}
curl -s localhost:<port>/__annotations                              # annotation inbox: unauthorized
curl -s -H "Authorization: Bearer $TOKEN" localhost:<port>/__annotations   # a listing
```

Then load the page as an ordinary reader and count the JavaScript requests, with the
Network panel or a headless run. A refused reader fetches strictly fewer files than an
allowed one — measured on a fresh Nuxt 4 project against this package: seven versus ten,
the difference being the toolbar's two chunks. If the counts match, the gate is decorative;
look for a static `import … from 'agentation-vue'` that pulled the library into the entry.

## Reading and answering annotations

- `curl -s 'localhost:<port>/__annotations?format=markdown'` — every open note, with its
  id, its target and the request that closes it. `?status=implemented|rejected|closed|all`,
  `?session=<id>` to narrow it.
- `curl -s -X POST localhost:<port>/__annotations/resolve -H 'content-type: application/json' -d '{"ids":["<id>"],"status":"rejected","resolution":"why"}'`
  — answers which ids were closed and which it never had. Both closing statuses take the
  note out of the human's toolbar; `rejected` is how an agent says no without going silent.
- `GET /__annotations/access` answers `{ allowed }` and never refuses: it is how the client
  decides whether to show a toolbar at all.
- `POST /__annotations` is what the toolbar itself does; the body is
  `{ sessionId, origin, url, annotations, markdown }`
  (`modules/annotation-inbox/contract.ts`). A note the tab stops sending is
  deleted while it is still open and kept once it has been answered — dropping
  the marker is how the tab acknowledges the answer, and the answer is what the
  listing is for. An empty `annotations` array therefore clears a session that
  holds nothing answered, and nothing else.

Against a deployed server every one of these needs `-H "Authorization: Bearer $TOKEN"`.

### An MCP server over the inbox

Agents answer notes more reliably through a tool than through a remembered `curl` line. The
inbox is plain HTTP, so a stdio MCP server over it is one file in the consuming project —
and it belongs there rather than here, because the only project-specific fact is *which
port is holding the notes*: your dev server, or Storybook, or a deployed origin.

Two tools are enough: one that `GET`s the listing (`status`, `session`, `format`, `origin`)
and one that `POST`s `/resolve` (`ids`, `status`, `resolution`). Worth building in:

- Resolve the origin per call — an environment variable first, then probe your candidate
  ports and take the first that answers `/__annotations` with JSON. A *neighbouring*
  project's dev server on the port you expected answers with its own HTML, and the
  content-type check is what tells them apart.
- Send the bearer token when one is configured, so the same tool works against a
  deployment.
- Name the origin in connection errors. `fetch failed` does not say which address was
  tried, which is the only question when nothing answers.

## Storage

The server half touches nothing but an unstorage `Storage`, so where annotations live is
the host's decision, not this package's. The module mounts a filesystem driver rooted at
`.data/annotations` under the name `annotation-inbox` at build time, and it does so with
`??=`, so a host that configures that mount itself keeps its own.

A host that wants the notes queryable or container-proof mounts something else under that
name. SQLite through [db0](https://github.com/unjs/db0), where each note is a row:

```ts
// server/plugins/annotation-inbox-storage.ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createDatabase } from 'db0'
import nodeSqlite from 'db0/connectors/node-sqlite'
import db0Driver from 'unstorage/drivers/db0'

const mount = 'annotation-inbox'                        // the layer's INBOX_STORAGE_MOUNT
const file = '.data/annotations/inbox.sqlite'           // inside INBOX_DIR: one volume covers both

export default defineNitroPlugin(async () => {
  mkdirSync(dirname(file), { recursive: true })         // node:sqlite will not create the parent
  const database = createDatabase(nodeSqlite({ path: file }))
  const storage = useStorage()
  await storage.unmount(mount, false)                   // mount() refuses a name already taken
  storage.mount(mount, db0Driver({ database, tableName: 'annotation_inbox' }))
})
```

Three things that bite in that order: `node:sqlite` reports a missing parent directory as
"unable to open database file" rather than creating one; `useStorage().mount()` refuses a
name that is already mounted, so the layer's build-time default has to be unmounted first;
and `unmount(name, false)` — a disposing unmount deletes the directory's contents on some
drivers. `db0` is your dependency, not this package's; add it yourself. Both halves log
once per process that they are experimental (unstorage's "Database driver is experimental",
Node's `ExperimentalWarning` for `node:sqlite`); neither indicates a misconfiguration.

Then the question the layout exists for is a query:

```sql
select json_extract(value, '$.status')     as status,
       json_extract(value, '$.target.ref') as ref,
       json_extract(value, '$.resolution') as resolution
from annotation_inbox where key like 'items:%';
```

Note for anything that iterates keys: unstorage treats `:` as a segment separator, so
`getKeys('items:<sessionId>')` — a partial prefix *inside* a segment — matches nothing,
while `getKeys('items')` works. That is why a session's membership lives in its
`itemIds` array and not in its key prefix.

## The shipped skill

`skills/annotation-inbox/SKILL.md` travels with the package: the agent that installs the
layer also gets its operating manual — how to read the notes and map each one back to a
line, and how to wire the toolbar into a project that does not have it yet. It is
model-invoked, so it triggers on "I left you notes" and on "this button sits too low"
without anybody naming the skill.

Wiring it up in a consuming project is one of:

```
npx skills add mortegro/nuxt-annotation-inbox
ln -s ../../node_modules/nuxt-layer-annotation-inbox/skills/annotation-inbox .claude/skills/annotation-inbox
```

A symlink keeps the manual in step with the package on every update; a copy is fine if
your skill loader does not follow links.

## What is inside

```
package.json                                    name, exports, the tsdown build
nuxt.config.ts                                  the layer, deliberately empty
modules/annotation-inbox/index.ts               registers the halves, routes, storage mount
modules/annotation-inbox/contract.ts            route, mount name, item and session types
modules/annotation-inbox/inbox.ts               the framework-neutral core: storage + routes
modules/annotation-inbox/vite.ts                the dev-server adapter; Storybook's entry
modules/annotation-inbox/runtime/server/handler.ts  the Nitro adapter, and who is allowed in
modules/annotation-inbox/runtime/mount.ts       the toolbar mount, both harnesses
modules/annotation-inbox/runtime/inbox.ts       storage adapter, component detector, poller
modules/annotation-inbox/runtime/plugin.client.ts  Nuxt's entry into the mount
dist/vite.mjs                                   built from vite.ts, the `./vite` export
skills/annotation-inbox/SKILL.md                the agent's operating manual
test/                                           the contract, the adapter, the licence locks
LICENSE                                         MIT, for this wiring
```

Nothing here imports anything from outside the layer except its own dependencies, which is
what makes copying the directory enough.

## How the toolbar reaches a browser

The toolbar ships in production builds, and the guarantee is not "absent" but "never
arrives unasked": it is a chunk of its own, fetched only after `/__annotations/access` has
said this reader may annotate. A reader who may not downloads none of it. That holds only
while the code keeps a precise shape, so `test/locks.spec.ts` asserts the shape rather than
trusting it:

1. Exactly one file in the package names `agentation-vue` at all — the shared mount, which
   Nuxt reaches through a plugin and Storybook imports from `preview.ts`.
2. Every reference to the library is a dynamic `import()`, placed *after* the access probe.
   A single static import collapses the whole property with no runtime symptom: a top-level
   import is part of the module graph before any branch runs, so the library lands in the
   entry chunk and every reader downloads it whatever the gate answers.
3. The build is told not to hint the gated chunks. Nuxt turns a dynamic plugin import into
   `<link rel="prefetch">`, and a prefetched chunk is a downloaded chunk — measured on a
   production build, a refused reader had fetched both library chunks before `/access`
   answered. The module's `build:manifest` hook clears `prefetch`/`preload` for them.
4. The package owns the dependency: a project installing this layer lists it once, as this
   package's dependency, and not in its own manifest.

If you deploy a built Storybook rather than throwing it away, check it too:
`grep -rl agentation storybook-static/` after a build should find nothing, because
`VueTracer()` disables itself outside `vite dev` and the toolbar's mount is not reached
from a static build's preview.

## Licence

This layer is the wiring; the toolbar it mounts is
[`agentation-vue`](https://www.npmjs.com/package/agentation-vue), licensed under [PolyForm
Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — not an open source
licence: any use except building a competing product. That is why *how* it reaches a
browser is a tested property rather than a habit, and why the access gate stands in front
of the imports rather than behind them. `vite-plugin-vue-tracer` is MIT.
