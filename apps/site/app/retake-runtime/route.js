// The time runtime as the script tag the proxy puts first in the frame's page,
// set up as the front server sets it up for Next (bootAt "load", holdScripts)
// with the frame known by Sec-Fetch-Dest (marker "header"). Built once, at
// build time.
import { retakeDev } from "../../src/retake.js"

export const dynamic = "force-static"

export async function GET() {
  const { runtimeTag } = await retakeDev()
  const tag = runtimeTag({ rt: { marker: "header", bootAt: "load", holdScripts: true } })
  return new Response(tag, { headers: { "content-type": "text/plain; charset=utf-8" } })
}
