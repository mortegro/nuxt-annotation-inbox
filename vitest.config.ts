import { defineConfig } from 'vitest/config'

// The package's own runner. Nothing here needs a DOM or Nuxt: one spec drives
// the inbox handler through a real `http.createServer`, the other reads the
// package's source off disk. It exists so the layer can be checked out on its
// own — after the extraction this directory is a repository — and a repository
// whose tests only run from inside somebody else's suite has no tests. While
// the layer is still in tree the host repo's root config includes the same
// files in its `unit` project, so both entry points run them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
})
