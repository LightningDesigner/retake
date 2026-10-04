// One example note, and what Retake's own code makes of it. The MCP answers on
// /docs/output and /docs/mcp aren't written by hand: they come from the
// published package's MCP tools (retake-dev/src/server/mcp.js), run at build
// time against this session, so the docs show exactly what an agent gets.
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

// The element as the dock describes it when the note is written (shell/30-notes.js, describe()).
const el = {
  label: "<li.toast>",
  text: "Saved Draft synced a moment ago",
  selector: "#toasts > li.toast:nth-of-type(2)",
  components: ["Toast", "ToastStack"],
  source: { file: "/src/components/Toast.tsx", line: 42, mapped: true },
  classes: ["toast", "is-entering"],
  styles: {
    display: "flex",
    position: "absolute",
    width: "320px",
    height: "56px",
    padding: "12px 14px",
    color: "rgb(237, 237, 237)",
    "background-color": "rgb(22, 22, 26)",
    "font-size": "14px",
    "font-weight": "400",
    "border-radius": "14px",
    opacity: "0.62",
    transform: "matrix(1, 0, 0, 1, 0, 8)",
    transition: "transform 0.35s linear, opacity 0.35s ease",
    gap: "12px",
  },
  rect: { x: 24, y: 612, w: 320, h: 56 },
  page: "/settings",
}

const clip = { id: 7, offset: 140, duration: 350, label: "transform", kind: "transition", property: "transform", selector: el.selector }

// The note as the server keeps it in .retake/session.json (CONTRACT.md "Note").
export const NOTE = {
  id: "nmg3k2x1a9f",
  branchId: 2,
  t: 6380,
  clip,
  selector: el.selector,
  component: el.components[0],
  source: el.source,
  classes: el.classes,
  rect: el.rect,
  text: "Ease this out instead of linear, and start it 60ms later",
  status: "pending",
  replies: [] as Array<{ from: string; text: string; at: number }>,
  el,
}

export const SESSION = {
  branches: [
    { id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: null, end: 9120 },
    { id: 2, parentId: 1, forkAt: 4210, name: "Timeline 2", codeVersion: null, end: 7840 },
  ],
  activeId: 2,
  markers: [],
  notes: [NOTE],
}

// What "Copy for agent" puts on the clipboard for NOTE: the dock's prompt()
// (shell/30-notes.js), line for line, for a recording that starts at 0.
export const COPY_PROMPT = [
  `## ${NOTE.text}`,
  "",
  `Page: ${el.page}`,
  `Element: ${el.label} "${el.text}"`,
  `Selector: ${el.selector}`,
  `Component: ${el.components.join(" < ")}`,
  `Source: ${el.source.file}:${el.source.line}`,
  `Classes: ${el.classes.join(" ")}`,
  `Computed: ${Object.entries(el.styles).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
  `Size: ${el.rect.w}×${el.rect.h} at (${el.rect.x}, ${el.rect.y})`,
  `Moment: 00:06.38 into the recording, 140ms into a 350ms transform transition on ${el.selector}`,
  `Timeline: "Timeline 2", branched from "Timeline 1" at 00:04.21`,
].join("\n")

// Timeline 2's recording around the note, in the shape `retake mcp` reads
// (readRecording in src/server/moments.js): the user typed a title, saved, the
// request came back and the toast slid in. Times in ms on the recording's clock.
export const RECORDING = {
  v: 1,
  start: 0,
  end: 7840,
  events: [
    { t: 4980, type: "focusin", editable: true, css: "#draft-title", label: "Title" },
    { t: 5010, type: "input", inputType: "insertText", data: "Q", css: "#draft-title", value: "Q" },
    { t: 5400, type: "input", inputType: "insertText", data: "3 plan", css: "#draft-title", value: "Q3 plan" },
    { t: 5980, type: "click", css: "#save", label: "Save" },
    { t: 6230, type: "net", list: "fetches", i: 0, kind: "end" },
  ],
  fetches: [{ t0: 5990, key: "POST /api/drafts", status: 200 }],
  routes: [],
  segments: [],
  clips: [
    { id: 7, start: 6240, end: 6590, kind: "transition", property: "transform", label: "transform", selector: el.selector, component: "Toast", from: { transform: "translateY(16px)" }, to: { transform: "none" } },
    { id: 8, start: 6240, end: 6590, kind: "transition", property: "opacity", label: "opacity", selector: el.selector, component: "Toast", from: { opacity: "0" }, to: { opacity: "1" } },
    { id: 9, start: 6000, end: 6600, kind: "css-animation", label: "spin", selector: "#save > svg.spinner", dur: 600, iterations: 1 },
  ],
}

// Code timelines (GET /__retake/code), before and after the agent's edit:
// Timeline 2's code is on disk, then Toast.tsx changes in Timeline 2 only.
const V1 = "7f3a1c5e90"
const V2 = "b41c09e2d7"
const codeState = (edited: boolean) => ({
  enabled: true,
  checkedOut: 2,
  checkedOutName: "Timeline 2",
  disk: edited ? V2 : V1,
  newest: edited ? V2 : V1,
  suspended: null,
  lease: null,
  leaseLost: null,
  timelines: {
    1: { fork: V1, head: V1, changed: 0, files: [] },
    2: edited ? { fork: V1, head: V2, changed: 1, files: ["src/components/Toast.tsx"] } : { fork: V1, head: V1, changed: 0, files: [] },
  },
})

const PATCH = `diff --git a/src/components/Toast.tsx b/src/components/Toast.tsx
--- a/src/components/Toast.tsx
+++ b/src/components/Toast.tsx
@@ -40,7 +40,7 @@ export function Toast({ title, body }: ToastProps) {
   return (
     <li
       className="toast is-entering"
-      style={{ transition: "transform 0.35s linear, opacity 0.35s ease" }}
+      style={{ transition: "transform 0.35s ease-out 60ms, opacity 0.35s ease" }}
     >`

interface Tools {
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
}

// retake-dev's MCP tools over a client that answers from SESSION instead of a
// running dev server. Loaded unbundled, from the package's own files.
// `edited`: after the agent's edit landed in Timeline 2.
async function tools(edited = false): Promise<Tools> {
  const req = createRequire(path.join(process.cwd(), "package.json"))
  const dir = path.dirname(req.resolve("retake-dev/package.json"))
  const mcp = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(dir, "src", "server", "mcp.js")).href)
  const notes = () => SESSION.notes
  return mcp.createTools({
    base: () => "http://localhost:3014",
    root: () => process.cwd(),
    session: async () => SESSION,
    recording: async () => RECORDING,
    notes: async () => notes(),
    note: async (id: string) => {
      const n = notes().find((x) => String(x.id) === String(id))
      if (!n) throw new Error(`GET /__retake/notes/${id} → 404: {"error":"no such note"}`)
      return n
    },
    patch: async (id: string) => ({ ...notes().find((x) => String(x.id) === String(id)) }),
    nextEvent: async () => null,
    code: async () => codeState(edited),
    codeDiff: async () => ({ branch: 2, against: "fork", from: V1, to: V2, files: [{ path: "src/components/Toast.tsx", status: "modified" }], patch: PATCH }),
    codeCheckout: async (body: { branchId: number }) => ({
      ok: true,
      branchId: body.branchId,
      version: body.branchId === 2 ? V2 : V1,
      enabled: true,
      files: [{ path: "src/components/Toast.tsx", change: "write" }],
    }),
  })
}

// A tool's answer as the agent reads it: the text in the MCP result.
async function call(name: string, args: Record<string, unknown> = {}, edited = false) {
  const out = await (await tools(edited)).handlers[name](args)
  return typeof out === "string" ? out : JSON.stringify(out, null, 2)
}

export const getNoteText = () => call("get_note", { id: NOTE.id })
export const listNotesText = () => call("list_notes")
export const activeTimelineText = () => call("get_active_timeline")
export const resolveText = () => call("resolve", { id: NOTE.id, summary: "Switched the toast's transform to ease-out and added a 60ms delay in Toast.tsx." })
export const momentText = () => call("get_moment", { id: NOTE.id, before_seconds: 1.5, after_seconds: 1 })
export const timelineEventsText = () => call("get_timeline_events", { timeline: "Timeline 2", from: "00:05.00", to: "00:07.00" })
export const animationText = () => call("get_animation", { id: NOTE.id, at: "00:06.38" })
export const checkoutText = () => call("checkout_timeline", { timeline: "Timeline 1" }, true)
export const codeDiffText = () => call("get_code_diff", { timeline: "Timeline 2" }, true)
