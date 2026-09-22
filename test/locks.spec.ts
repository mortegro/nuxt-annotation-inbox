import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * This package exists to put a toolbar in front of a developer, and the whole
 * argument for shipping it as a layer is that nothing it touches survives a
 * production build. That argument is a rule, and a rule nobody can break by
 * accident is a rule a test states.
 *
 * `agentation-vue` is third-party and licensed under PolyForm Shield 1.0.0 —
 * not an open-source licence, and not one a project installing this layer
 * wants to be distributing under. Nothing about the dependency enforces that:
 * `npm` installs it exactly as it installs anything else, and the one thing
 * keeping it out of a consumer's bundle is how this package *references* it. A
 * static `import … from 'agentation-vue'` in the mount, or a second file here
 * that decides the toolbar would be handy somewhere else, reads as one
 * innocuous line in review and shows up afterwards only as a client bundle
 * nobody measures. There is no runtime symptom to notice: the toolbar would
 * simply also be there in production, and a reviewer looking at `/` would have
 * to know it should not be.
 *
 * The consuming repo can assert that *its own* sources never name the package
 * — this study does, in `test/unit/annotation-toolbar.spec.ts` — but it cannot
 * assert anything about the shape of the code in here, and after extraction it
 * will not even have the files. So the locks that make the layer safe to
 * install live with the layer, and they are these, each of which fails
 * silently:
 *
 * 1. Exactly one file in the package names the package at all — the shared
 *    mount, which Nuxt reaches through a dev-only plugin and Storybook imports
 *    from its `preview.ts`. Asserted as an equality, not a subset: a second
 *    importer is the failure the rule is about, and an allowlist that outlives
 *    its file is an allowlist that has stopped describing the package.
 * 2. That mount reaches the package only from a branch its bundler can prove
 *    dead outside development, and the Nuxt module registers the mount only
 *    under `nuxt dev` — so under Nuxt the file is not even in the graph whose
 *    branches would have to be folded. See the case below for the causal
 *    chain, and for the ordering property the mount has already lost once.
 * 3. The package is *this layer's* dependency. A layer another project
 *    installs has to install what it uses, so the entry lives in this
 *    directory's `package.json`; whether the consuming root manifest stays
 *    clean is the consumer's own gate to keep.
 *
 * Read as text off disk rather than through the bundler: the property being
 * asserted is what the source *says*, and the only way to ask the bundler
 * instead would be to build a consuming app and grep the output — a
 * several-minute gate for a rule that is three string searches.
 */

const layerRoot = fileURLToPath(new URL('..', import.meta.url))

/** The package whose reachability is the rule. */
const PACKAGE = 'agentation-vue'

/**
 * The one mount, shared by both harnesses. Sharing became safe when the Nuxt
 * side stopped being a scanned `app/plugins/` file: the plugin that imports
 * this is registered by the module below and only under `nuxt dev`, so the
 * shipped plugin graph has no reference to fold away in the first place.
 */
const MOUNT = 'modules/annotation-inbox/runtime/mount.ts'

/** The Nuxt module — the registration guard is the subject of one clause below. */
const MODULE = 'modules/annotation-inbox/index.ts'

/** This package's manifest, which owns the dependency. */
const MANIFEST = 'package.json'

/**
 * The mount, paired with the early return its bundler folds away outside
 * development: Vite substitutes `import.meta.env.DEV` under `storybook build`,
 * and Nuxt substitutes the same literal in a production build it would never
 * reach this file from anyway.
 *
 * The guard is matched as the **statement**, not as the literal. The file also
 * names its literal in the prose that explains it, and a search for the bare
 * name is therefore satisfied by a comment: deleting the real `if` and leaving
 * its paragraph behind kept this case green until the pattern was tightened.
 * Asserted by the shape that actually eliminates code.
 */
const MOUNTS = [
  { file: MOUNT, literal: 'import.meta.env.DEV', guard: /if\s*\(\s*!import\.meta\.env\.DEV\s*\)\s*return\b/ },
] as const

/** The allowlist of the first case: the mounts, in the order a scan yields. */
const ALLOWED: readonly string[] = MOUNTS.map(mount => mount.file).sort()

/**
 * Where this package's source lives. `modules/` is nearly all of it — the
 * Vite plugin, the Nuxt module and the runtime the two share — plus the
 * layer's own `nuxt.config.ts`. `test/` is in the list so that a fixture or
 * helper landing beside the specs is scanned like anything else; the specs
 * themselves are taken back out below. Root files are named one by one rather
 * than globbed: the root also holds `package.json`, which legitimately names
 * the package.
 *
 * `tsdown.config.ts` is left out on purpose, and the omission is the
 * interesting one. It names `agentation-vue` in its `external` list — a bare
 * string in an array, not a specifier — so scanning it would change nothing
 * today; it stays out because it is not code any consumer's bundler ever
 * reaches, and the rule this scan states is about reachable code. The build
 * config's own subject, which entries ship compiled and which ship as source,
 * is argued in the file itself.
 */
const SCANNED_DIRS: readonly string[] = ['modules', 'test']
const SCANNED_ROOT_FILES: readonly string[] = ['nuxt.config.ts']

/** Extensions worth reading as text; anything else cannot hold an import. */
const SCANNED = /\.(?:ts|vue|js|mjs|css|json)$/

/**
 * The package's own specs, excluded from the scan by `scannedFiles()`. This
 * one quotes the forbidden line in order to explain it, and a rule that cannot
 * say what it is about is a rule nobody can read. Anything else that ends up
 * beside them — a fixture, a helper — is scanned like the rest.
 */
const SPEC = /\.spec\.ts$/

/** Every scanned file, as a layer-relative POSIX path a human can paste. */
function scannedFiles(): string[] {
  const fromDirs = SCANNED_DIRS.filter(dir => existsSync(resolve(layerRoot, dir))).flatMap(dir =>
    readdirSync(resolve(layerRoot, dir), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && SCANNED.test(entry.name))
      .map(entry => [relative(layerRoot, entry.parentPath).split(sep).join('/'), entry.name].join('/')),
  )

  return [...fromDirs, ...SCANNED_ROOT_FILES.filter(file => existsSync(resolve(layerRoot, file)))]
    // The specs quote the forbidden line to explain what it forbids, and a
    // rule that cannot state its own subject is a rule nobody can read.
    // Excluding them costs nothing: a spec is not a code path a build reaches,
    // and it is not published either.
    .filter(file => !SPEC.test(file))
    .sort()
}

/**
 * The package where it is *reachable* — as the specifier of an `import`, a
 * dynamic `import()` or a `require`, with or without a subpath and query.
 *
 * Deliberately not a scan for the bare name. Files may write the name down
 * without depending on it, and `contract.ts` does: its storage key happens to
 * start with it. Matching the bare name would fail that file and teach the
 * next author to talk around the subject rather than name it; matching the
 * specifier catches the one shape that actually puts the dependency on a code
 * path.
 */
const IMPORT_OF_PACKAGE = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${PACKAGE}(?:/[^'"]*)?['"]`)

/** A scanned file's text. Every read in this spec goes through the layer root. */
function source(file: string): string {
  return readFileSync(resolve(layerRoot, file), 'utf8')
}

describe('the annotation toolbar stays out of what ships', () => {
  it('is named by exactly the file that mounts it', () => {
    // The failure this catches in both directions: a second file in the
    // package importing the toolbar — a component, a composable that wanted
    // its selector logic — puts a PolyForm Shield dependency on a code path
    // some consumer's build reaches, and an allowlist entry with no file
    // behind it is a rule guarding something that no longer exists.
    const referencing = scannedFiles().filter(file => IMPORT_OF_PACKAGE.test(source(file)))

    expect(
      referencing,
      `Exactly one file may import \`${PACKAGE}\`: \`${ALLOWED.join('`, `')}\`. It is a development `
      + 'tool under PolyForm Shield 1.0.0, so every reference to it must sit on a file that no build '
      + 'reaches. If something else needs what the toolbar does, it needs its own answer, not this '
      + 'dependency; if the allowed file is gone, the toolbar is gone with it and this list should '
      + 'shrink in the same commit.',
    ).toEqual([...ALLOWED])
  })

  it('reaches the package only from a build-time dev branch', () => {
    // The causal chain this protects, link by link. Vite replaces
    // `import.meta.env.DEV` with `false` outside development — under
    // `storybook build`, and in a Nuxt production build for anything still in
    // the graph; Rollup then folds the `if (!false) return` guard and drops
    // everything after it, *including* the dynamic `import()` calls, so no
    // `agentation-vue` chunk is emitted at all. That elimination is the only
    // reason a consumer's `storybook-static/` is free of the toolbar — there
    // is no plugin filter, no external, no manual exclusion anywhere else.
    //
    // A single static `import … from 'agentation-vue'` breaks it silently: a
    // top-level import is evaluated before any branch and is therefore part of
    // the module graph whatever the literal was replaced by. The toolbar would
    // ship, and the only visible symptom would be a bigger bundle.
    for (const { file, literal, guard } of MOUNTS) {
      const text = source(file)
      const guardAt = text.search(guard)

      expect(
        guardAt,
        `\`${file}\` no longer opens with \`if (!${literal}) return\`. That literal is what its bundler `
        + 'replaces with `false` outside development, and the dead-branch elimination that follows is '
        + 'the only thing keeping the toolbar out of the build. Matched as the statement, not the name: '
        + 'the file also spells the literal out in the prose that explains it, and a comment is not a '
        + 'guard.',
      ).toBeGreaterThanOrEqual(0)

      const staticImports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s*['"]([^'"]+)['"]/g)]
        .map(match => match[1]!)
        .filter(specifier => specifier.startsWith(PACKAGE))

      expect(
        staticImports,
        `A static import of \`${PACKAGE}\` was added to \`${file}\`. A top-level import is part of the `
        + `module graph before any branch runs, so the \`${literal}\` guard cannot remove it and the `
        + 'toolbar ships. Move it into the `await import()` inside the guarded branch.',
      ).toEqual([])

      const dynamic = [...text.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]!)
      const mentions = [...text.matchAll(new RegExp(`['"]${PACKAGE}[^'"]*['"]`, 'g'))].map(match => match[0]!.slice(1, -1))

      expect(
        mentions.filter(specifier => !dynamic.includes(specifier)),
        `Every reference to \`${PACKAGE}\` in \`${file}\` has to be a dynamic \`import()\` inside the `
        + `\`${literal}\` branch — that is the shape Rollup can drop wholesale.`,
      ).toEqual([])

      // A scan that matches nothing is a green test that gates nothing, and
      // both specifiers can drift: the component and its stylesheet are
      // imported separately because the stylesheet is pulled in `?inline`, as
      // a string for the shadow root rather than a tag in `<head>`.
      expect(dynamic).toEqual(expect.arrayContaining([PACKAGE, `${PACKAGE}/style.css?inline`]))

      // The one property a reader would not think to check, and the one that
      // actually failed: the guard has to stand *before* the imports it is
      // supposed to remove. The mount also asks three runtime questions — is
      // there a document, is this happy-dom, is this the browser runner — and
      // with one of those in front instead, the dynamic imports stay reachable
      // for anything static analysis can see. That is measured, not
      // theoretical: a `storybook:build` of the study this layer grew up in
      // emitted an `assets/agentation-*.js` chunk into `storybook-static/` — a
      // deployable artefact carrying a PolyForm Shield dependency — until the
      // `import.meta.env.DEV` guard was put first.
      //
      // Comparing source positions is the honest way to state that, and it is
      // exact about the failure it names: an import above the guard is
      // reachable code, and reachable code is a chunk in the build.
      const firstImportOfPackage = text.search(new RegExp(`import\\(\\s*['"]${PACKAGE}`))

      expect(
        guardAt,
        `In \`${file}\` a dynamic \`import()\` of \`${PACKAGE}\` comes before the \`${literal}\` guard. `
        + 'Everything the guard deletes has to sit after it: this is the shape that regressed once '
        + 'already, and the symptom was an `agentation-*.js` chunk in a build nobody inspects.',
      ).toBeLessThan(firstImportOfPackage)
    }

    // The Nuxt half of the rule, and it is about registration rather than
    // elimination. The mount is shared with Storybook, which is only safe
    // because nothing in a consumer's scanned source points at it: the plugin
    // that does is added by this module, behind a `nuxt.options.dev` check
    // that stands before the `addPlugin` call. Lose that order — or the check
    // — and a production build gains a plugin entry importing a PolyForm
    // Shield package, which is precisely the state a `$production.ignore`
    // entry used to be needed to work around.
    const moduleText = source(MODULE)
    const devGuardAt = moduleText.search(/if\s*\(\s*!nuxt\.options\.dev\b[^\n]*\)\s*return\b/)

    expect(
      devGuardAt,
      `\`${MODULE}\` no longer returns early unless \`nuxt.options.dev\`. That guard is what keeps the `
      + 'toolbar plugin out of a production build entirely — without it the mount is a live reference '
      + "in the shipped plugin graph, and the mount's own `import.meta.env.DEV` branch is the only "
      + 'thing left between the build and the dependency.',
    ).toBeGreaterThanOrEqual(0)

    expect(
      devGuardAt,
      `In \`${MODULE}\` the \`addPlugin\` call comes before the \`nuxt.options.dev\` guard, so the `
      + 'toolbar is registered in every build.',
    ).toBeLessThan(moduleText.indexOf('addPlugin('))
  })

  it('declares the package as its own dependency', () => {
    // The layer has to *own* the dependency. A project installs this package
    // as a devDependency and gets whatever this manifest names installed with
    // it; an entry left to the consuming root instead would make the layer
    // silently broken in the next project that installs it. Keeping it out of
    // their production `dependencies` is the consumer's gate, not this one —
    // in this study, `test/unit/annotation-toolbar.spec.ts`.
    const manifest = JSON.parse(source(MANIFEST)) as { dependencies?: Record<string, string> }

    expect(
      Object.keys(manifest.dependencies ?? {}),
      `\`${PACKAGE}\` belongs in \`${MANIFEST}\`'s \`dependencies\`. The layer is installed as a `
      + "devDependency by whoever uses it, and a layer's own dependencies have to install with it — "
      + 'as `dependencies`, or the copy in the next project resolves nothing.',
    ).toContain(PACKAGE)
  })
})
