---
name: annotation-inbox
description: Set up the annotation toolbar in a Nuxt or Storybook project, and read the annotations a human left by clicking the running app. Use when asked to install or wire the annotation inbox, when the human says they left notes or annotations, or when they describe something they pointed at ("this button", "the spacing here") rather than named.
---

# Annotation inbox

A human clicks an element in the running app, writes a comment, and the server stores that
comment together with the file and line of the template that draws the element. You read
those notes, act, and — this is new — say what you did: every note has a status, and
leaving it `open` means the human is still waiting.

## Reading annotations

Read them when the human says they left notes, and read them unprompted when they ask
about something they *pointed at* rather than named — "this button sits too low", "the
spacing here is wrong". That sentence has no referent in the repo; the annotation is the
referent.

```
curl -s 'localhost:<port>/__annotations?format=markdown'
```

Port 3000/3040 for the Nuxt dev server, 6011 for Storybook. Default is every open note
across every tab; `?status=closed` shows what has been answered, `?status=all` everything,
`?session=<id>` one browser tab. An empty listing is not an error: it means nobody has an
open note.

Each item carries a `**Comment:**`, a `**Target:**` (what the note is about, and the one
line to open first), a `**Path:**` (the CSS selector, which says where on screen the thing
ended up) and a `**Components:**` chain. The target is derived for you:

```
- **Target:** element `app/components/guide/GuidePicker.vue:42:5`
- **Target:** route `/guide/atem`
```

`element` when the tracer knew the source position — open that file and line. `route` when
it did not, which is what a production build gives: the note is about that page, and the
`**Path:**` selector plus the comment are what narrow it down. A note never has no target.

Read the components chain backwards when you need the call site: the last segment is the
element's own `file:line:column`, the chain above it is its ancestry, and that only matters
when the element is rendered from more than one place.

## Answering a note

When you have acted on a note, or decided not to, say so. This is not bookkeeping: it is
what makes the note disappear from the human's toolbar, and `rejected` without a reason
tells them nothing.

```
curl -s -X POST localhost:<port>/__annotations/resolve \
  -H 'content-type: application/json' \
  -d '{"ids":["<inboxId>"],"status":"implemented","resolution":"Abstand auf 12px"}'
```

`status` is `implemented` or `rejected`; `resolution` is your sentence to the human and is
what a refusal is *for* — "widerspricht dem Phone-Frame" is an answer, silence is not. The
response names which ids were closed and which it never had. Resolving again corrects a
note you closed too early.

**Done when** every annotation in the listing is either mapped to a file and a line and
resolved, or resolved as `rejected` with a reason. A note you silently skipped is a note
the human believes you read.

## Installing it

Add `nuxt-layer-annotation-inbox` as a devDependency, and add `.data/` to `.gitignore` —
the notes are as ephemeral as the browser session they were made in and are never
committed.

For Nuxt, one line in `nuxt.config.ts` and nothing else:

```ts
extends: ['nuxt-layer-annotation-inbox']
```

The layer's module registers the toolbar plugin and the endpoint only when
`nuxt.options.dev` is true, so there is no flag to set and no condition to write: outside a
dev server the layer contributes nothing to the app graph.

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by hand.
In `.storybook/main.ts`, inside `viteFinal`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from 'nuxt-layer-annotation-inbox/vite'

plugins: [vue(), VueTracer(), annotationInbox({ endpoint: true })],
```

`VueTracer` is what supplies the `file:line:column` segment; without it the annotations
still name every component and its SFC, they just stop naming the line. Nuxt registers the
tracer itself through DevTools' component inspector, which is why the Nuxt side needs no
equivalent line.

In `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from 'nuxt-layer-annotation-inbox/mount'

setup(() => mountAnnotationToolbar())
```

Use `setup()` rather than a decorator. It is the one hook only Storybook's own renderer
reaches, so a Vitest run that imports the preview registers the toolbar without ever
mounting it.

**Done when** both checks have been observed rather than assumed:

- The dev server logs `annotation inbox: /__annotations → .data/annotations/` on start, and
  `curl -s localhost:<port>/__annotations` answers with a listing.
- A note survives the round trip: annotate something, see it `open` in the listing, resolve
  it, and see it leave the default listing and the toolbar.

## Beyond that

The package README covers what only some projects need: how a browser tab becomes a
session and why each note is its own storage entry, how a host mounts a database under the
store instead of the filesystem default, the PolyForm Shield licence of the toolbar library
and what it permits, and the POST contract the toolbar speaks. Read it when a question is
about the mechanism rather than about using it.
