// ---------------------------------------------------------------------------
// polyfills.js — standard methods that some browsers do not have yet.
//
// Must be imported BEFORE pdf.js, and into the worker as well as the main
// thread, since both use these.
// ---------------------------------------------------------------------------

// Map.prototype.getOrInsert / getOrInsertComputed are a recent addition to the
// language. Chrome has them; Safari does not, and pdf.js 6 uses them with no
// fallback of its own — so on an iPhone every PDF fails to open with
// "getOrInsertComputed is not a function".
function addMissing(target, name, value) {
  if (target && !target.prototype[name]) {
    Object.defineProperty(target.prototype, name, { value, writable: true, configurable: true })
  }
}

for (const Collection of [globalThis.Map, globalThis.WeakMap]) {
  addMissing(Collection, 'getOrInsert', function (key, valueIfMissing) {
    if (!this.has(key)) this.set(key, valueIfMissing)
    return this.get(key)
  })

  addMissing(Collection, 'getOrInsertComputed', function (key, compute) {
    if (!this.has(key)) this.set(key, compute(key))
    return this.get(key)
  })
}

// Reading a stream with `for await` is also recent. Safari on the iPhone does
// not have it, and pdf.js reads every page's text that way — so searching a
// document, and making a scan searchable, failed there with
// "undefined is not a function (near '...e of t...')".
if (globalThis.ReadableStream && !ReadableStream.prototype[Symbol.asyncIterator]) {
  const values = async function* ({ preventCancel = false } = {}) {
    const reader = this.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      if (!preventCancel) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  addMissing(globalThis.ReadableStream, 'values', values)
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true })
}
