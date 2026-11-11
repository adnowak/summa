import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { INVALID_ADD_CALL_ERROR } from "../add-call.mjs";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function startMock(records) {
  const requests = [];
  let index = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({ url: req.url, body });
    const content = records[Math.min(index, records.length - 1)];
    index += 1;
    const payload = JSON.stringify({
      choices: [{ message: { content } }],
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(payload);
  });
  return { server, requests, portReady: listen(server) };
}

function startOpenSearch() {
  let statement = null;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: req.method, url: req.url, raw });
    const pathOnly = req.url.split("?")[0];
    if (req.method === "GET" && pathOnly === "/knowledge/_doc/statement") {
      if (!statement) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ found: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ found: true, _source: statement }));
      return;
    }
    if (req.method === "PUT" && pathOnly === "/knowledge/_doc/statement") {
      statement = JSON.parse(raw || "{}");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "created" }));
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { reason: "unexpected request" } }));
  });
  return { server, requests, portReady: listen(server) };
}

async function startSumma(baseUrl, options = {}) {
  const search = options.search || startOpenSearch();
  const searchPort = options.search ? options.search.server.address().port : await search.portReady;
  const opensearchUrl =
    options.opensearchUrl === undefined
      ? `http://127.0.0.1:${searchPort}`
      : options.opensearchUrl;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENROUTER_API_KEY: options.apiKey === undefined ? "test-key" : options.apiKey,
      OPENROUTER_BASE_URL: baseUrl,
      OPENROUTER_MODEL: "mock-model",
      OPENSEARCH_URL: opensearchUrl,
      OPENSEARCH_USERNAME: "",
      OPENSEARCH_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  let errBuf = "";
  child.stderr.on("data", (chunk) => {
    errBuf += chunk;
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not start\n${buf}\n${errBuf}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const match = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${buf}\n${errBuf}`));
    });
  });
  return {
    port,
    opensearchUrl,
    search: options.search || search,
    ownsSearch: !options.search,
    stop() {
      child.kill();
    },
  };
}

async function stopSumma(summa) {
  summa.stop();
  if (summa.ownsSearch) {
    await close(summa.search.server);
  }
}

async function putKnowledge(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/knowledge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getKnowledge(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/knowledge`);
  return { status: response.status, body: await response.json() };
}

async function postChat(port, message) {
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, body: await response.json() };
}

test("the page accepts two asks and both replies show the same sum", async () => {
  const mock = startMock([
    '{"tool":"add","a":2,"b":3}',
    '{"tool":"add","a":2,"b":3}',
  ]);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`);
  try {
    const page = await fetch(`http://127.0.0.1:${summa.port}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /id="chat-form"/);

    const first = await postChat(summa.port, "add 2 and 3");
    const second = await postChat(summa.port, "add 2 and 3");
    assert.deepEqual(first, { status: 200, body: { reply: "5" } });
    assert.deepEqual(second, { status: 200, body: { reply: "5" } });
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].body.response_format.type, "json_schema");
    assert.equal(mock.requests[0].body.messages.at(-1).content, "add 2 and 3");
  } finally {
    await stopSumma(summa);
    await close(mock.server);
  }
});

test("the http path repairs once and then returns the sum", async () => {
  const mock = startMock(["The sum is 5.", '{"tool":"add","a":20,"b":22}']);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`);
  try {
    const result = await postChat(summa.port, "add 20 and 22");
    assert.deepEqual(result, { status: 200, body: { reply: "42" } });
    assert.equal(mock.requests.length, 2);
    assert.match(mock.requests[1].body.messages.at(-1).content, /incorrect syntax/);
  } finally {
    await stopSumma(summa);
    await close(mock.server);
  }
});

test("the http path returns the call error when every repair stays invalid", async () => {
  const mock = startMock(["nope", "nope", "nope", "nope"]);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`);
  try {
    const result = await postChat(summa.port, "add 2 and 3");
    assert.deepEqual(result, {
      status: 502,
      body: { error: INVALID_ADD_CALL_ERROR },
    });
    assert.equal(mock.requests.length, 4);
  } finally {
    await stopSumma(summa);
    await close(mock.server);
  }
});

test("a missing message and a missing key keep their http errors", async () => {
  const mock = startMock(['{"tool":"add","a":1,"b":1}']);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`);
  const childWithoutKey = spawn(process.execPath, ["server.mjs"], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENROUTER_API_KEY: "",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      OPENROUTER_MODEL: "mock-model",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  const barePort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("bare server did not start")), 5000);
    childWithoutKey.stdout.on("data", (chunk) => {
      buf += chunk;
      const match = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  try {
    const empty = await postChat(summa.port, "   ");
    assert.deepEqual(empty, { status: 400, body: { error: "message is required." } });
    const badJson = await fetch(`http://127.0.0.1:${summa.port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
    const missingKey = await postChat(barePort, "add 2 and 3");
    assert.equal(missingKey.status, 500);
    assert.match(missingKey.body.error, /OPENROUTER_API_KEY/);
  } finally {
    await stopSumma(summa);
    childWithoutKey.kill();
    await close(mock.server);
  }
});

test("the page saves a statement, shows the edit, and reads it from OpenSearch after restart", async () => {
  const search = startOpenSearch();
  const searchPort = await search.portReady;
  const mock = startMock(["unused"]);
  const mockPort = await mock.portReady;
  const llm = `http://127.0.0.1:${mockPort}/v1`;
  const opensearchUrl = `http://127.0.0.1:${searchPort}`;
  const first = await startSumma(llm, { search, opensearchUrl });
  let second = null;
  try {
    const page = await fetch(`http://127.0.0.1:${first.port}/`);
    const html = await page.text();
    assert.match(html, /id="knowledge-form"/);
    assert.match(html, /No statement saved/);

    const created = await putKnowledge(first.port, {
      label: " office hours ",
      text: " The office is open 9:00 to 17:00. ",
    });
    assert.deepEqual(created, {
      status: 200,
      body: {
        statement: {
          label: "office hours",
          text: "The office is open 9:00 to 17:00.",
        },
      },
    });
    assert.equal(search.requests.at(-1).method, "PUT");
    assert.match(search.requests.at(-1).url, /\/knowledge\/_doc\/statement\?refresh=wait_for$/);

    const seen = await getKnowledge(first.port);
    assert.deepEqual(seen.body, created.body);

    const edited = await putKnowledge(first.port, {
      label: "desk",
      text: "The desk faces the window.",
    });
    assert.deepEqual(edited.body.statement, {
      label: "desk",
      text: "The desk faces the window.",
    });
    const afterEdit = await getKnowledge(first.port);
    assert.deepEqual(afterEdit.body.statement, edited.body.statement);

    const blank = await putKnowledge(first.port, { label: "  ", text: "hello" });
    assert.deepEqual(blank, { status: 400, body: { error: "label is required." } });

    first.stop();
    second = await startSumma(llm, { search, opensearchUrl });
    const again = await getKnowledge(second.port);
    assert.deepEqual(again.body.statement, {
      label: "desk",
      text: "The desk faces the window.",
    });
  } finally {
    first.stop();
    if (second) {
      second.stop();
    }
    await close(mock.server);
    await close(search.server);
  }
});

test("a saved statement is included in the completion and the model reply is shown", async () => {
  const reply = "Come by during office hours. The office is open 9:00 to 17:00.";
  const mock = startMock([reply]);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`);
  try {
    const saved = await putKnowledge(summa.port, {
      label: "office hours",
      text: "The office is open 9:00 to 17:00.",
    });
    assert.equal(saved.status, 200);
    const result = await postChat(summa.port, "When can I come by?");
    assert.deepEqual(result, { status: 200, body: { reply } });
    const body = mock.requests[0].body;
    assert.equal(body.response_format, undefined);
    assert.match(body.messages[0].content, /^Label: office hours\nText: The office is open 9:00 to 17:00\./);
    assert.equal(body.messages[1].content, "When can I come by?");
  } finally {
    await stopSumma(summa);
    await close(mock.server);
  }
});

test("chat reports a missing OpenSearch URL", async () => {
  const mock = startMock(['{"tool":"add","a":1,"b":1}']);
  const mockPort = await mock.portReady;
  const summa = await startSumma(`http://127.0.0.1:${mockPort}/v1`, { opensearchUrl: "" });
  try {
    const result = await postChat(summa.port, "add 2 and 3");
    assert.equal(result.status, 500);
    assert.match(result.body.error, /OPENSEARCH_URL/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await stopSumma(summa);
    await close(mock.server);
  }
});
