// injectHtml (src/core.js): the runtime tag goes first in <head> however the
// page arrives (chunk boundaries, compression). Node only, no browser.
import zlib from "node:zlib"
import { Readable } from "node:stream"
import { test, expect } from "@playwright/test"
import { injectHtml, runtimeScript, runtimeSource, runtimeTag } from "../../src/core.js"

const TAG = "<script data-retake>RT</script>"

// Push `chunks` (strings or Buffers) through the transform; returns the output.
async function run(chunks, options, tag = TAG) {
  const t = injectHtml(tag, options)
  const out = []
  t.on("data", (c) => out.push(c))
  const done = new Promise((resolve, reject) => {
    t.on("end", resolve)
    t.on("error", reject)
  })
  Readable.from(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).pipe(t)
  await done
  return Buffer.concat(out).toString("utf8")
}

test("after the <head> tag, even split across chunks", async () => {
  expect(await run(["<!doctype html><html><he", "ad><title>x</title></head><body></body></html>"])).toBe(
    `<!doctype html><html><head>${TAG}<title>x</title></head><body></body></html>`,
  )
  // split inside the tag's attributes
  expect(await run(['<html><head data-a="1', '" lang=en><script src=/a.js></script></head>'])).toBe(
    `<html><head data-a="1" lang=en>${TAG}<script src=/a.js></script></head>`,
  )
  // a <header> is not a <head>
  expect(await run(["<html><body><header>h</header></body>"])).toBe(`<html>${TAG}<body><header>h</header></body>`)
})

test("a <head> inside a comment isn't the head (F68)", async () => {
  expect(await run(["<!doctype html><!-- the <head> goes here --><html><head><title>x</title></head>"])).toBe(
    `<!doctype html><!-- the <head> goes here --><html><head>${TAG}<title>x</title></head>`,
  )
  // a comment still open at the end of a chunk
  expect(await run(["<!doctype html><!-- <head", "> --><html><head lang=en></head><body></body>"])).toBe(
    `<!doctype html><!-- <head> --><html><head lang=en>${TAG}</head><body></body>`,
  )
})

test("a <meta charset> right after <head> stays first", async () => {
  expect(await run(['<html><head><meta charset="utf-8"><link rel=stylesheet href=a.css>'])).toBe(
    `<html><head><meta charset="utf-8">${TAG}<link rel=stylesheet href=a.css>`,
  )
  // not when an app script comes before it
  expect(await run(["<html><head><script>a()</script><meta charset=utf-8>"])).toBe(`<html><head>${TAG}<script>a()</script><meta charset=utf-8>`)
})

test("no <head>: before the first body/script/link/meta", async () => {
  expect(await run(["<!doctype html><title>t</title><p>hi"])).toBe(`<!doctype html>${TAG}<title>t</title><p>hi`)
  expect(await run(["<!doctype html>", "<script>x</script>"])).toBe(`<!doctype html>${TAG}<script>x</script>`)
  // nothing to go by: after the doctype when the page ends (not before it: quirks mode)
  expect(await run(["<!doctype html>", "hello"])).toBe(`<!doctype html>${TAG}hello`)
  expect(await run(["hello"])).toBe(`${TAG}hello`)
  expect(await run([])).toBe(TAG)
})

test("holds at most 64 KB back", async () => {
  const big = "<!doctype html><!-- " + "x".repeat(70 * 1024) + " -->"
  const t = injectHtml(TAG)
  let first = null
  t.once("data", (c) => (first = c.toString("utf8")))
  t.write(Buffer.from(big))
  await new Promise((r) => setImmediate(r))
  // out before the page ends
  expect(first).not.toBeNull()
  expect(first.startsWith(`<!doctype html>${TAG}`)).toBe(true)
  t.end()
})

test("a multi-byte character split across chunks survives", async () => {
  const html = Buffer.from("<html><head><title>héllo — 日本</title></head>")
  const cut = html.indexOf(Buffer.from("日")) + 1 // inside the 3-byte character
  expect(await run([html.subarray(0, 8), html.subarray(8, cut), html.subarray(cut)])).toBe(`<html><head>${TAG}<title>héllo — 日本</title></head>`)
  const head = Buffer.from("<html><head>é")
  expect(await run([head.subarray(0, head.length - 1), head.subarray(head.length - 1)])).toBe(`<html><head>${TAG}é`)
})

test("gzip, br and deflate bodies are decoded", async () => {
  const html = "<!doctype html><html><head><title>z</title></head><body>" + "ü".repeat(5000) + "</body></html>"
  const want = html.replace("<head>", `<head>${TAG}`)
  for (const [encoding, data] of [
    ["gzip", zlib.gzipSync(html)],
    ["br", zlib.brotliCompressSync(html)],
    ["deflate", zlib.deflateSync(html)],
  ]) {
    // in small pieces, like a stream would bring them
    const pieces = []
    for (let i = 0; i < data.length; i += 37) pieces.push(data.subarray(i, i + 37))
    expect(await run(pieces, { encoding }), encoding).toBe(want)
  }
  expect(() => injectHtml(TAG, { encoding: "x-weird" })).toThrow(/content-encoding/)
})

test("the runtime tag: self-removing, guarded, RT config", () => {
  const src = runtimeSource()
  expect(src).toContain('const RT = Object.freeze({"marker":"url","bootAt":"dcl","exemptUrls":[],"holdScripts":false,"next":null,"docId":null,"docStored":false})')
  expect(runtimeSource({ marker: "header" })).toContain('"marker":"header"')
  const header = runtimeScript({ marker: "header" })
  expect(header.indexOf("currentScript")).toBeLessThan(header.indexOf("__retakeShell"))
  expect(header).toContain("isAppFrame")
  expect(header).not.toContain("__wb=app(") // the header marker never trusts the URL
  expect(runtimeScript()).toContain("__wb=app")
  expect(runtimeTag({ script: "x", nonce: 'a"b' })).toBe('<script data-retake nonce="a&quot;b">x</script>')
  new Function(header) // parses
})
