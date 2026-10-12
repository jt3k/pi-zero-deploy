import { IncomingMessage } from "node:http"

type Handler = (params: Record<string, string>, ctx: Request) => void
type Routes = Record<string, Handler>

export default (routes: Routes, ctx: IncomingMessage) => {
  for (const [template, handler] of Object.entries(routes)) {
    const paramNames = [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])

    const regexPattern = template.replace(/\{[^}]+\}/g, "([^/]+)")
    const regex = new RegExp(`^${regexPattern}$`)

    const match = ctx.url.match(regex)
    if (match) {
      const paramValues = match.slice(1)
      const params = Object.fromEntries(
        paramNames.map((name, i) => [name, paramValues[i]]),
      )

      handler(params, ctx)
      return true
    }
  }
  return false
}
