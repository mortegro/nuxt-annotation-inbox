# annotation-inbox

A Nuxt 4 layer that turns "this button sits too low" into a file in your working copy, with
the line of the SFC that draws the button.

## What it does

Under `nuxt dev` — and nowhere else — a small toolbar hangs off `<body>`. A human clicks an
element, writes a comment, and the note is mirrored to the dev server, which writes two
files per origin:

```
.data/annotations/localhost-3040.json   every field, machine-readable
.data/annotations/localhost-3040.md     the same text the toolbar's Copy button produces
```

An agent reads those files. No browser extension, no MCP server, no clipboard step, and
nothing that only works in Chromium.

Each annotation names the element three ways, and the third is the useful one:

```
- **Path:** div#__nuxt > div.phone > … > div.guide-grid > button.guide-card > img.guide-img
- **Components:** nuxt-root > NuxtLayout > WalkFrame (app/components/layout/WalkFrame.vue) > GuidePicker (app/components/guide/GuidePicker.vue) > app/components/guide/GuidePicker.vue:42:5
```

Every component in the chain carries its SFC path relative to the workspace root, and the
final segment is the annotated element's own position in the template it is written in.
Open that first.

**One tab per origin.** The files mirror the most recently active tab: each tab publishes
its whole session on load and on every change, so two tabs on one origin overwrite each
other, and a fresh tab deletes the files a previous session left behind. That is the
intended lifetime — the notes are as ephemeral as the session they were made in, which is
why `.data/` is gitignored.

## Install

Two ways, both with no line of config:

- **Copy** `layers/annotation-inbox/` into your project's `layers/`. Nuxt 4 extends every
  directory under `~~/layers/` automatically. Run your package manager afterwards so the
  layer's own dependencies (`agentation-vue`, `vite-plugin-vue-tracer`) are installed —
  with npm workspaces, `"workspaces": ["layers/*"]` in the root manifest is enough.
- **Depend on it**: add `nuxt-layer-annotation-inbox` as a devDependency (from git or a
  registry) and put `extends: ['nuxt-layer-annotation-inbox']` in `nuxt.config.ts`.

Requirements: Nuxt 4, and DevTools left enabled with their default `componentInspector` —
that is what registers `vite-plugin-vue-tracer`, and the tracer is what supplies the
`file:line:column` segment. With devtools off, annotations still name every component and
its file; they just stop naming the line. Adding `VueTracer()` to the module's
`addVitePlugin` call brings it back (the tracer skips already-instrumented files, so a
double registration is harmless).

Add `.data/` to `.gitignore` if it is not there already.

## Storybook

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by
hand — two lines in `.storybook/main.ts`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from '../layers/annotation-inbox/modules/annotation-inbox/vite.ts'

// in viteFinal's mergeConfig:
plugins: [vue(), ...(process.env.VITEST ? [] : [VueTracer(), annotationInbox()])],
```

and one in `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from '../layers/annotation-inbox/modules/annotation-inbox/runtime/mount'

setup(() => mountAnnotationToolbar())
```

`setup()` rather than a decorator: it is the one hook only Storybook's own renderer
reaches, so importing the preview from Vitest registers the toolbar without ever mounting
it. The `VITEST` gate keeps the endpoint and the instrumentation out of a browser-mode
Vitest project that loads `main.ts` through `@storybook/addon-vitest`.

Storybook is its own origin, so its annotations are their own session and their own file
(`localhost-6011.*`).

## Reading annotations

- `cat .data/annotations/localhost-3040.md` — the markdown, one `## Feedback` block per
  session. A missing file means there are no annotations.
- `curl http://localhost:3040/__boje/annotations` — every origin's record as JSON, keyed
  by origin, served by whichever dev server is running.
- `POST` to the same route is what the toolbar itself does; the body is
  `{ origin, url, annotations, markdown }` (`modules/annotation-inbox/contract.ts`). An
  empty `annotations` array deletes the origin's files.

## What is inside

```
nuxt.config.ts                                  the layer, deliberately empty
modules/annotation-inbox/index.ts               registers the two halves, dev only
modules/annotation-inbox/contract.ts            route, directory, payload types
modules/annotation-inbox/vite.ts                the endpoint; also Storybook's entry
modules/annotation-inbox/runtime/mount.ts       the toolbar mount, both harnesses
modules/annotation-inbox/runtime/inbox.ts       storage adapter and component detector
modules/annotation-inbox/runtime/plugin.client.ts  Nuxt's entry into the mount
```

Nothing here imports anything from outside the layer except its own dependencies, which is
what makes copying the directory enough.

## Nothing reaches a build

Four independent locks, because one that fails silently is no lock:

1. The module returns early unless `nuxt.options.dev` — outside a dev server it registers
   no plugin and no Vite plugin, so nothing in the app graph refers to the toolbar at all.
2. The Vite plugin is `apply: 'serve'`, so the endpoint cannot exist in a build.
3. The mount's first statement is `if (!import.meta.env.DEV) return`, ahead of every
   dynamic `import()`, so any bundler that does see the file folds the branch and drops
   the chunks.
4. `VueTracer()`, where a project registers it by hand, disables itself outside
   `vite dev`, so a Storybook build carries no instrumentation either. Worth checking if
   your built Storybook is deployed rather than thrown away: `grep -rl "agentation" <output>`
   after a build should find nothing.

## Licence

This layer is the wiring; the toolbar it mounts is
[`agentation-vue`](https://www.npmjs.com/package/agentation-vue), licensed under [PolyForm
Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — not an open source
licence: any use except building a competing product. Acceptable for a tool that only ever
runs on a developer's machine, and the reason the three locks above are a property worth
testing rather than a habit. `vite-plugin-vue-tracer` is MIT.
