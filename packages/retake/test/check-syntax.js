// Parses the concatenated runtime (and the script servers inject, with its
// guard) so a syntax error shows up before a browser does.
import { runtimeSource } from "../src/plugin.js"
import { runtimeScript } from "../src/core.js"
new Function(runtimeSource())
new Function(runtimeScript({ marker: "header" }))
console.log("runtime ok,", runtimeSource().length, "chars")
