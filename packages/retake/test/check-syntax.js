// Parses the concatenated runtime so a syntax error shows up before a browser does.
import { runtimeSource } from "../src/plugin.js"
new Function(runtimeSource())
console.log("runtime ok,", runtimeSource().length, "chars")
