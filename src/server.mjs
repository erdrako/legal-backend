import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.mjs";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const bundlePath = process.env.APPROVED_BUNDLE_PATH ?? "examples/approved-bundle.example.json";
const approvedBundle = JSON.parse(readFileSync(resolve(bundlePath), "utf8"));
const app = createApp(approvedBundle);

const server = createServer((request, response) => {
  const result = app.handle({
    method: request.method,
    url: request.url
  });

  response.writeHead(result.status, result.headers);
  response.end(JSON.stringify(result.body));
});

server.listen(port, () => {
  console.log(`LexMapa backend listening on http://localhost:${port}`);
});

