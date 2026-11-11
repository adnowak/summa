import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_ADD_CALL_ERROR, SYSTEM_PROMPT } from "../add-call.mjs";
import { citationInstructions, runChat } from "../chat.mjs";

const config = {
  apiKey: "test-key",
  model: "mock-model",
  baseUrl: "http://upstream.test/v1",
  referer: "http://127.0.0.1:3000",
  appTitle: "Summa",
};

function completion(content) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return { choices: [{ message: { content } }] };
    },
  };
}

async function runWith(scripted, message = "add 2 and 3", statement = null) {
  const calls = [];
  let index = 0;
  const result = await runChat({
    ...config,
    message,
    statement,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const next = scripted[Math.min(index, scripted.length - 1)];
      index += 1;
      return next;
    },
  });
  return { result, calls };
}

test("a valid call record returns the decimal sum from local add", async () => {
  const { result, calls } = await runWith([
    completion('{"tool":"add","a":2,"b":3}'),
  ]);
  const again = await runWith([completion('{"tool":"add","a":2,"b":3}')]);

  assert.deepEqual(result, { status: 200, body: { reply: "5" } });
  assert.deepEqual(again.result, { status: 200, body: { reply: "5" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://upstream.test/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].body.model, "mock-model");
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.response_format.json_schema.name, "add_call");
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
  assert.deepEqual(calls[0].body.provider, { require_parameters: true });
  assert.deepEqual(calls[0].body.messages[0], { role: "system", content: SYSTEM_PROMPT });
  assert.deepEqual(calls[0].body.messages[1], { role: "user", content: "add 2 and 3" });
});

test("large integer tokens stay exact in the reply", async () => {
  const record = '{"tool":"add","a":9007199254740993,"b":1}';
  const { result } = await runWith([completion(record)]);
  const again = await runWith([completion(record)]);
  assert.deepEqual(result, { status: 200, body: { reply: "9007199254740994" } });
  assert.deepEqual(again.result, result);
});

test("incorrect syntax is sent back and a later valid record is added", async () => {
  const { result, calls } = await runWith([
    completion("The sum is 5."),
    completion('{"tool":"add","a":2,"b":3}'),
  ]);

  assert.deepEqual(result, { status: 200, body: { reply: "5" } });
  assert.equal(calls.length, 2);
  const messages = calls[1].body.messages;
  assert.deepEqual(messages[2], { role: "assistant", content: "The sum is 5." });
  assert.match(messages[3].content, /incorrect syntax: Completion must be a JSON object\./);
  assert.equal(calls[1].body.response_format.json_schema.name, "add_call");
});

test("the third repair can still return the sum", async () => {
  const { result, calls } = await runWith([
    completion("nope"),
    completion("nope"),
    completion("nope"),
    completion('{"tool":"add","a":-2,"b":-3}'),
  ]);
  assert.deepEqual(result, { status: 200, body: { reply: "-5" } });
  assert.equal(calls.length, 4);
});

test("a still-invalid record after 3 repairs returns the error", async () => {
  const { result, calls } = await runWith([
    completion("nope"),
    completion("nope"),
    completion("nope"),
    completion("still nope"),
  ]);
  assert.deepEqual(result, { status: 502, body: { error: INVALID_ADD_CALL_ERROR } });
  assert.equal(calls.length, 4);
});

test("an upstream failure is returned without using a repair", async () => {
  const { result, calls } = await runWith([
    {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      async json() {
        return { error: { message: "schema rejected" } };
      },
    },
  ]);
  assert.deepEqual(result, {
    status: 502,
    body: { error: "External LLM error: schema rejected" },
  });
  assert.equal(calls.length, 1);
});

test("a network failure is returned without using a repair", async () => {
  const calls = [];
  const result = await runChat({
    ...config,
    message: "add 2 and 3",
    fetchImpl: async () => {
      calls.push(1);
      throw new Error("connect ECONNREFUSED");
    },
  });
  assert.deepEqual(result, {
    status: 502,
    body: { error: "Failed to reach the external LLM: connect ECONNREFUSED" },
  });
  assert.equal(calls.length, 1);
});

test("a stored statement is one completion and the reply is the model text", async () => {
  const statement = {
    label: "office hours",
    text: "The office is open 9:00 to 17:00.",
  };
  const reply = "Come by during office hours. The office is open 9:00 to 17:00.";
  const { result, calls } = await runWith([completion(reply)], "When can I come by?", statement);

  assert.deepEqual(result, { status: 200, body: { reply } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[0].body.provider, undefined);
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.messages[0], {
    role: "system",
    content: citationInstructions(statement),
  });
  assert.match(calls[0].body.messages[0].content, /Label: office hours/);
  assert.match(calls[0].body.messages[0].content, /Text: The office is open 9:00 to 17:00\./);
  assert.deepEqual(calls[0].body.messages[1], {
    role: "user",
    content: "When can I come by?",
  });
});

test("an empty citation reply is an error", async () => {
  const statement = { label: "office hours", text: "The office is open 9:00 to 17:00." };
  const { result, calls } = await runWith([completion("  ")], "When can I come by?", statement);
  assert.deepEqual(result, {
    status: 502,
    body: { error: "External LLM returned no reply text." },
  });
  assert.equal(calls.length, 1);
});

test("a missing API key is an error before any completion", async () => {
  let called = false;
  const result = await runChat({
    ...config,
    apiKey: "",
    message: "add 2 and 3",
    fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });
  assert.equal(called, false);
  assert.equal(result.status, 500);
});
