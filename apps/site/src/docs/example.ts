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

interface Tools {
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
}

// retake-dev's MCP tools over a client that answers from SESSION instead of a
// running dev server. Loaded unbundled, from the package's own files.
async function tools(): Promise<Tools> {
  const req = createRequire(path.join(process.cwd(), "package.json"))
  const dir = path.dirname(req.resolve("retake-dev/package.json"))
  const mcp = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(dir, "src", "server", "mcp.js")).href)
  const notes = () => SESSION.notes
  return mcp.createTools({
    base: () => "http://localhost:3014",
    root: () => process.cwd(),
    session: async () => SESSION,
    recording: async () => null,
    notes: async () => notes(),
    note: async (id: string) => {
      const n = notes().find((x) => String(x.id) === String(id))
      if (!n) throw new Error(`GET /__retake/notes/${id} → 404: {"error":"no such note"}`)
      return n
    },
    patch: async (id: string) => ({ ...notes().find((x) => String(x.id) === String(id)) }),
    nextEvent: async () => null,
  })
}

// A tool's answer as the agent reads it: the text in the MCP result.
async function call(name: string, args: Record<string, unknown> = {}) {
  const out = await (await tools()).handlers[name](args)
  return typeof out === "string" ? out : JSON.stringify(out, null, 2)
}

export const getNoteText = () => call("get_note", { id: NOTE.id })
export const listNotesText = () => call("list_notes")
export const activeTimelineText = () => call("get_active_timeline")
export const resolveText = () => call("resolve", { id: NOTE.id, summary: "Switched the toast's transform to ease-out and added a 60ms delay in Toast.tsx." })
