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

Add the package as a devDependency and extend it:

```jsonc
// package.json
"devDependencies": { "nuxt-layer-annotation-inbox": "^0.1.0" }
```

```ts
// nuxt.config.ts
extends: ['nuxt-layer-annotation-inbox']
```

That is the whole Nuxt side. The layer's module registers the toolbar plugin and the
endpoint only when `nuxt.options.dev` is true, so there is no flag and no condition to
write yourself.

Add `.data/` to `.gitignore` if it is not there already.

**Copying the directory** into your project's `layers/` still works and is the fallback for
a project that cannot take the dependency: Nuxt 4 extends every directory under
`~~/layers/` automatically, so no `extends` line is needed in that mode. Run your package
manager afterwards so the layer's own dependencies (`agentation-vue`,
`vite-plugin-vue-tracer`) are installed — with npm workspaces, `"workspaces": ["layers/*"]`
in the root manifest is enough. Now that the package is published this is the fallback
rather than the recommendation, because a copy does not get updates.

Requirements: Nuxt 4, and DevTools left enabled with their default `componentInspector` —
that is what registers `vite-plugin-vue-tracer`, and the tracer is what supplies the
`file:line:column` segment. With devtools off, annotations still name every component and
its file; they just stop naming the line. Adding `VueTracer()` to the module's
`addVitePlugin` call brings it back (the tracer skips already-instrumented files, so a
double registration is harmless).

## Storybook

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by
hand — two lines in `.storybook/main.ts`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from 'nuxt-layer-annotation-inbox/vite'

// in viteFinal's mergeConfig:
plugins: [vue(), ...(process.env.VITEST ? [] : [VueTracer(), annotationInbox()])],
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

The two subpaths are deliberately different in kind. `./vite` is built to `dist/vite.mjs`,
because it is loaded by Node — and Node will not type-strip TypeScript that lives under
`node_modules`. `./mount` is the raw `.ts` source, because its consumer is a Vite pipeline
that compiles it anyway, and shipping it precompiled would put the
`if (!import.meta.env.DEV) return` guard behind a build boundary where the consumer's
bundler can no longer fold the branch away.

Storybook is its own origin, so its annotations are their own session and their own file
(`localhost-6011.*`).

## Reading annotations

- `cat .data/annotations/localhost-3040.md` — the markdown, one `## Feedback` block per
  session. A missing file means there are no annotations.
- `curl http://localhost:3040/__annotations` — every origin's record as JSON, keyed
  by origin, served by whichever dev server is running.
- `POST` to the same route is what the toolbar itself does; the body is
  `{ origin, url, annotations, markdown }` (`modules/annotation-inbox/contract.ts`). An
  empty `annotations` array deletes the origin's files.

## The shipped skill

`skills/annotation-inbox/SKILL.md` travels with the package: the agent that installs the
layer also gets its operating manual — how to read the files and map each annotation back
to a line, and how to wire the toolbar into a project that does not have it yet. It is
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
modules/annotation-inbox/index.ts               registers the two halves, dev only
modules/annotation-inbox/contract.ts            route, directory, payload types
modules/annotation-inbox/vite.ts                the endpoint; also Storybook's entry
modules/annotation-inbox/runtime/mount.ts       the toolbar mount, both harnesses
modules/annotation-inbox/runtime/inbox.ts       storage adapter and component detector
modules/annotation-inbox/runtime/plugin.client.ts  Nuxt's entry into the mount
dist/vite.mjs                                   built from vite.ts, the `./vite` export
skills/annotation-inbox/SKILL.md                the agent's operating manual
test/                                           the contract and the build locks
LICENSE                                         MIT, for this wiring
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

`test/locks.spec.ts` asserts all four against the source, so a refactor that quietly drops
one fails here rather than in somebody's production bundle.

## Licence

This layer is the wiring; the toolbar it mounts is
[`agentation-vue`](https://www.npmjs.com/package/agentation-vue), licensed under [PolyForm
Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — not an open source
licence: any use except building a competing product. Acceptable for a tool that only ever
runs on a developer's machine, and the reason the four locks above are a property worth
testing rather than a habit. `vite-plugin-vue-tracer` is MIT.
