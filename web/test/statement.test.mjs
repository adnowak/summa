import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanStatement,
  readStatement,
  writeStatement,
} from "../statement.mjs";

const config = {
  url: "http://search.test",
  username: "",
  password: "",
};

function jsonResponse(status, body, statusText = "OK") {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    async json() {
      return body;
    },
  };
}

test("blank label or text is rejected before any request", () => {
  assert.deepEqual(cleanStatement({ label: "  ", text: "hello" }), {
    error: "label is required.",
  });
  assert.deepEqual(cleanStatement({ label: "hours", text: " \n" }), {
    error: "text is required.",
  });
  assert.equal(cleanStatement({ label: " hours ", text: " open " }).statement.label, "hours");
  assert.equal(cleanStatement({ label: " hours ", text: " open " }).statement.text, "open");
});

test("a missing document is an empty statement", async () => {
  const missing = await readStatement(config, async () => jsonResponse(404, { found: false }, "Not Found"));
  assert.deepEqual(missing, { ok: true, statement: null });

  const explicit = await readStatement(config, async () => jsonResponse(200, { found: false }));
  assert.deepEqual(explicit, { ok: true, statement: null });
});

test("a stored document is returned as label and text", async () => {
  const result = await readStatement(config, async () =>
    jsonResponse(200, {
      found: true,
      _source: { label: "office hours", text: "The office is open 9:00 to 17:00." },
    }),
  );
  assert.deepEqual(result, {
    ok: true,
    statement: { label: "office hours", text: "The office is open 9:00 to 17:00." },
  });
});

test("write sends one document and reads it back from that response contract", async () => {
  const calls = [];
  const written = await writeStatement(
    { ...config, username: "summa", password: "secret" },
    { label: "office hours", text: "The office is open 9:00 to 17:00." },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, { result: "created" }, "Created");
    },
  );
  assert.deepEqual(written, {
    ok: true,
    statement: { label: "office hours", text: "The office is open 9:00 to 17:00." },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://search.test/knowledge/_doc/statement?refresh=wait_for");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from("summa:secret").toString("base64")}`,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    label: "office hours",
    text: "The office is open 9:00 to 17:00.",
  });
});

test("a missing OpenSearch URL fails before any request", async () => {
  let called = false;
  const result = await readStatement({ url: "", username: "", password: "" }, async () => {
    called = true;
    throw new Error("should not be called");
  });
  assert.equal(called, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /OPENSEARCH_URL/);
});

test("an OpenSearch failure is returned", async () => {
  const refused = await readStatement(config, async () => {
    throw new Error("connect ECONNREFUSED");
  });
  assert.deepEqual(refused, {
    ok: false,
    status: 502,
    error: "Failed to reach OpenSearch: connect ECONNREFUSED",
  });

  const bad = await readStatement(config, async () =>
    jsonResponse(400, { error: { reason: "parse failed" } }, "Bad Request"),
  );
  assert.deepEqual(bad, { ok: false, status: 502, error: "OpenSearch error: parse failed" });
});
