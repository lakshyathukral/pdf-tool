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
