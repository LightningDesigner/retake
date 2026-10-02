import { redirect } from "next/navigation"
export default function Slow() {
  redirect("/about?redirected=1")
}
