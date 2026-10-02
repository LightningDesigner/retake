import { L } from "./fx"
// Runs when its chunk arrives: one more Math.random() in the stream.
export default function late() {
  L("late", Math.random())
}
