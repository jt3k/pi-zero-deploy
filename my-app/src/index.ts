import { createServer } from "node:http"
import router from "./router"
const port = Number(process.env.PORT) || 1234

createServer((req, res) => {
  const routes = {
    "/"() {
      res.writeHead(200)
      res.end(JSON.stringify({ okAY: true }))
    },
    "/health"() {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }))
    },
  }

  // Указываем тип контента для всех успешных ответов
  res.setHeader("Content-Type", "application/json")

  const isMatched = router(routes, req)

  if (!isMatched) {
    // Сюда попадет только 404. Больше writeHead выше не вызывается.
    res.writeHead(404)
    res.end(JSON.stringify({ error: "Not Found" }))
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`listening on :${port}`)
})
