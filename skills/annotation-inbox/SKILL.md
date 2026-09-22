---
name: annotation-inbox
description: Set up the annotation toolbar in a Nuxt or Storybook project, and read the annotations a human left by clicking the running app. Use when asked to install or wire the annotation inbox, when the human says they left notes or annotations, or when they describe something they pointed at ("this button", "the spacing here") rather than named.
---

# Annotation inbox

A human clicks an element in the running app, writes a comment, and the dev server writes
that comment into the working copy together with the file and line of the template that
draws the element. This skill is both halves of using that: reading the notes, which is
what you will be doing almost every time, and installing the layer into a project, which
happens once.

## Reading annotations

Read them when the human says they left notes, and read them unprompted when they ask
about something they *pointed at* rather than named — "this button sits too low", "the
spacing here is wrong". That sentence has no referent in the repo; the annotation is the
referent.

```
cat .data/annotations/*.md
```

One file per origin, named `<host>-<port>.md`, so a project running both a Nuxt dev server
and Storybook has two. A missing file is not an error: it means nobody has annotated that
origin, because the toolbar deletes the file when the last note goes.

Each annotation carries a `**Comment:**`, a `**Path:**` (the CSS selector, which says
where on screen the thing ended up) and a `**Components:**` line. Read the components line
first, and read it backwards:

```
- **Components:** nuxt-root > NuxtLayout > WalkFrame (app/components/layout/WalkFrame.vue) > GuidePicker (app/components/guide/GuidePicker.vue) > app/components/guide/GuidePicker.vue:42:5
```

The final segment is not a component. It is the annotated element's own
`file:line:column` in the template that draws it, and it is the line to open before
anything else. The chain above it is the ancestry, and it matters only when the element is
rendered from more than one place and you need to know which call site the human was
looking at.

If a dev server is up, the same records are available over HTTP:

```
curl -s localhost:<port>/__annotations
```

That answers with every origin's record as JSON, keyed by origin, from whichever dev
server is running — useful when only one of the two harnesses is up and you want to know
whether the other left notes behind. `jq 'keys'` on it is the quickest "did anybody
annotate anything".

If no dev server is running there is nothing on disk, because the files are written by the
server, not by the browser. Do not guess which element the human meant from the prose
alone: ask them to press the toolbar's **Copy annotations** button and paste that output,
which is the same markdown the `.md` file holds.

**Done when** every annotation in the file is mapped to a file and a line, or is
explicitly reported back as unmappable. An annotation you silently skipped is a note the
human believes you read.

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

plugins: [vue(), VueTracer(), annotationInbox()],
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
  `curl -s localhost:<port>/__annotations` answers with JSON.
- A production build carries none of it: `grep -rl agentation <output-dir>` after building
  finds nothing.

## Beyond that

The package README covers what only some projects need: why the files mirror one tab per
origin, the four independent locks that keep the toolbar out of a build, the PolyForm
Shield licence of the toolbar library and what it permits, and the POST contract the
toolbar speaks. Read it when a question is about the mechanism rather than about using it.
