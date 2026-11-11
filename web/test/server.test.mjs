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

async function startSumma(baseUrl) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_BASE_URL: baseUrl,
      OPENROUTER_MODEL: "mock-model",
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
    stop() {
      child.kill();
    },
  };
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
    summa.stop();
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
    summa.stop();
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
    summa.stop();
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
    summa.stop();
    childWithoutKey.kill();
    await close(mock.server);
  }
});
