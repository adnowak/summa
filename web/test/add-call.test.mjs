import assert from "node:assert/strict";
import test from "node:test";
import { add, parseAddCall } from "../add-call.mjs";

test("add returns the same bigint sum for the same arguments", () => {
  assert.equal(add(2n, 3n), 5n);
  assert.equal(add(2n, 3n), 5n);
  assert.equal(add(-2n, -3n), -5n);
  assert.equal(add(0n, 0n), 0n);
  assert.equal(add(9007199254740993n, 1n), 9007199254740994n);
  assert.equal(add(-9007199254740993n, -1n), -9007199254740994n);
});

test("parseAddCall reads integer tokens as bigint in any key order", () => {
  const parsed = parseAddCall(
    ' \n { "b" : 1 , "tool" : "add" , "a" : 9007199254740993 } \n ',
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.a, 9007199254740993n);
  assert.equal(parsed.b, 1n);
});

test("parseAddCall accepts a negative integer and normalizes -0", () => {
  const parsed = parseAddCall('{"tool":"add","a":-2,"b":-0}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.a, -2n);
  assert.equal(parsed.b, 0n);
});

test("parseAddCall accepts an escaped tool name that decodes to add", () => {
  const parsed = parseAddCall('{"tool":"ad\\u0064","a":2,"b":3}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.a, 2n);
  assert.equal(parsed.b, 3n);
});

test("parseAddCall rejects syntax that is not the call record", () => {
  const cases = [
    ["", "Completion is empty."],
    ["   ", "Completion is empty."],
    ["The sum is 5.", "Completion must be a JSON object."],
    ['```json\n{"tool":"add","a":2,"b":3}\n```', "Completion must be a JSON object."],
    ['{"tool":"add","a":2,"b":3} trailing', "Completion has extra text after the call record."],
    ["[1, 2]", "Completion must be a JSON object."],
    ['{"tool":"add","a":2}', 'Completion must be a JSON object with keys "tool", "a", and "b" only.'],
    ['{"tool":"add","a":2,"b":3,"c":4}', 'Completion must be a JSON object with keys "tool", "a", and "b" only.'],
    ['{"tool":"sum","a":2,"b":3}', 'Field "tool" must be the string "add".'],
    ['{"tool":"add","a":2.0,"b":3}', 'Field "a" must be an integer.'],
    ['{"tool":"add","a":2e1,"b":3}', 'Field "a" must be an integer.'],
    ['{"tool":"add","a":"2","b":3}', 'Field "a" must be an integer.'],
    ['{"tool":"add","a":01,"b":3}', "Invalid JSON."],
    ['{"tool":"add","a":2,}', "Invalid JSON."],
    ['{"tool":"add","a":2,"a":3,"b":4}', 'Duplicate key "a".'],
  ];

  for (const [text, error] of cases) {
    assert.deepEqual(parseAddCall(text), { ok: false, error });
  }
});
