import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChat } from "./chat.mjs";
import {
  cleanStatement,
  opensearchConfigFromEnv,
  readStatement,
  writeStatement,
} from "./statement.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENROUTER_API_KEY || "";
const baseUrl = (
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
).replace(/\/$/, "");
const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const referer = process.env.OPENROUTER_HTTP_REFERER || "http://127.0.0.1:3000";
const appTitle = process.env.OPENROUTER_APP_TITLE || "Summa";
const opensearch = opensearchConfigFromEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  if (!apiKey) {
    sendJson(res, 500, {
      error: "OPENROUTER_API_KEY is not set in the server environment.",
    });
    return;
  }

  let message;
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  } catch {
    sendJson(res, 400, { error: "Request body must be JSON with a message string." });
    return;
  }

  if (!message) {
    sendJson(res, 400, { error: "message is required." });
    return;
  }

  const loaded = await readStatement(opensearch);
  if (!loaded.ok) {
    sendJson(res, loaded.status, { error: loaded.error });
    return;
  }

  const result = await runChat({
    message,
    apiKey,
    model,
    baseUrl,
    referer,
    appTitle,
    statement: loaded.statement,
  });
  sendJson(res, result.status, result.body);
}

async function handleReadKnowledge(res) {
  const loaded = await readStatement(opensearch);
  if (!loaded.ok) {
    sendJson(res, loaded.status, { error: loaded.error });
    return;
  }
  sendJson(res, 200, { statement: loaded.statement });
}

async function handleWriteKnowledge(req, res) {
  let parsed;
  try {
    parsed = JSON.parse((await readBody(req)) || "{}");
  } catch {
    sendJson(res, 400, { error: "Request body must be JSON with label and text." });
    return;
  }
  const cleaned = cleanStatement(parsed);
  if (cleaned.error) {
    sendJson(res, 400, { error: cleaned.error });
    return;
  }
  const written = await writeStatement(opensearch, cleaned.statement);
  if (!written.ok) {
    sendJson(res, written.status, { error: written.error });
    return;
  }
  sendJson(res, 200, { statement: written.statement });
}

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathOnly = (req.url || "").split("?")[0];

  if (req.method === "GET" && pathOnly === "/api/knowledge") {
    await handleReadKnowledge(res);
    return;
  }

  if (req.method === "PUT" && pathOnly === "/api/knowledge") {
    await handleWriteKnowledge(req, res);
    return;
  }

  if (req.method === "POST" && pathOnly === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  server.listen(port, () => {
    const actual = server.address().port;
    console.log(`Summa web listening on http://127.0.0.1:${actual}`);
  });
}
