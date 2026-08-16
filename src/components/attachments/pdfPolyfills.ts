/*
 * Imported for its side effect, before anything that pulls in pdf.js.
 *
 * pdf.js 5 calls Promise.withResolvers even in its legacy build, and iOS
 * Safari only gained it in 17.4 — without this shim, opening a PDF on a
 * slightly older iPhone threw "undefined is not a function" and the error
 * page took over the whole route.
 */

type Resolvers = {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const patchable = Promise as unknown as { withResolvers?: () => Resolvers }

if (typeof patchable.withResolvers !== 'function') {
  patchable.withResolvers = () => {
    let resolve!: Resolvers['resolve']
    let reject!: Resolvers['reject']
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

export {}
