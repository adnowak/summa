export const MAX_REPAIRS = 3;

export const INVALID_ADD_CALL_ERROR = "The model did not return a valid add call.";

export const SYSTEM_PROMPT = [
  'Call the add tool by returning only a JSON object {"tool":"add","a":<integer>,"b":<integer>}.',
  "a and b are JSON integers: an optional minus sign and digits, with no decimal point and no exponent.",
].join(" ");

export const addCallResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "add_call",
    strict: true,
    schema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          enum: ["add"],
          description: "The tool name. The only value is add.",
        },
        a: {
          type: "integer",
          description:
            "First integer. An optional minus sign and digits. No decimal point and no exponent.",
        },
        b: {
          type: "integer",
          description:
            "Second integer. An optional minus sign and digits. No decimal point and no exponent.",
        },
      },
      required: ["tool", "a", "b"],
      additionalProperties: false,
    },
  },
};

export function add(a, b) {
  return a + b;
}

export function repairInstruction(error) {
  return [
    `The previous completion has incorrect syntax: ${error}`,
    'Return only a JSON object {"tool":"add","a":<integer>,"b":<integer>} where a and b are JSON integers.',
  ].join("\n");
}

class CallSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "CallSyntaxError";
  }
}

class Scanner {
  constructor(text) {
    this.text = text;
    this.i = 0;
  }

  eof() {
    return this.i >= this.text.length;
  }

  peek() {
    return this.text[this.i];
  }

  bad(message = "Invalid JSON.") {
    throw new CallSyntaxError(message);
  }

  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.i += 1;
    }
  }

  expect(char) {
    if (this.peek() !== char) {
      this.bad();
    }
    this.i += 1;
  }

  parseValue() {
    this.skipWs();
    const ch = this.peek();
    if (ch === '"') {
      return { type: "string", value: this.parseString() };
    }
    if (ch === "{") {
      return this.parseObject();
    }
    if (ch === "[") {
      return this.parseArray();
    }
    if (ch === "t") {
      return this.parseLiteral("true", { type: "literal", value: true });
    }
    if (ch === "f") {
      return this.parseLiteral("false", { type: "literal", value: false });
    }
    if (ch === "n") {
      return this.parseLiteral("null", { type: "literal", value: null });
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      return this.parseNumber();
    }
    this.bad();
  }

  parseLiteral(word, node) {
    if (this.text.slice(this.i, this.i + word.length) !== word) {
      this.bad();
    }
    this.i += word.length;
    return node;
  }

  parseString() {
    this.expect('"');
    let out = "";
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === '"') {
        this.i += 1;
        return out;
      }
      if (ch === "\\") {
        this.i += 1;
        const esc = this.peek();
        const simple = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (Object.hasOwn(simple, esc)) {
          out += simple[esc];
          this.i += 1;
          continue;
        }
        if (esc === "u") {
          this.i += 1;
          const hex = this.text.slice(this.i, this.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.bad();
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          this.i += 4;
          continue;
        }
        this.bad();
      }
      if (ch.charCodeAt(0) < 0x20) {
        this.bad();
      }
      out += ch;
      this.i += 1;
    }
    this.bad();
  }

  parseNumber() {
    const start = this.i;
    if (this.peek() === "-") {
      this.i += 1;
    }
    if (this.peek() === "0") {
      this.i += 1;
    } else if (this.peek() >= "1" && this.peek() <= "9") {
      while (this.peek() >= "0" && this.peek() <= "9") {
        this.i += 1;
      }
    } else {
      this.bad();
    }
    let kind = "integer";
    if (this.peek() === ".") {
      kind = "number";
      this.i += 1;
      if (!(this.peek() >= "0" && this.peek() <= "9")) {
        this.bad();
      }
      while (this.peek() >= "0" && this.peek() <= "9") {
        this.i += 1;
      }
    }
    if (this.peek() === "e" || this.peek() === "E") {
      kind = "number";
      this.i += 1;
      if (this.peek() === "+" || this.peek() === "-") {
        this.i += 1;
      }
      if (!(this.peek() >= "0" && this.peek() <= "9")) {
        this.bad();
      }
      while (this.peek() >= "0" && this.peek() <= "9") {
        this.i += 1;
      }
    }
    return { type: kind, lexeme: this.text.slice(start, this.i) };
  }

  parseArray() {
    this.expect("[");
    this.skipWs();
    const items = [];
    if (this.peek() === "]") {
      this.i += 1;
      return { type: "array", items };
    }
    while (true) {
      items.push(this.parseValue());
      this.skipWs();
      if (this.peek() === ",") {
        this.i += 1;
        this.skipWs();
        if (this.peek() === "]") {
          this.bad();
        }
        continue;
      }
      if (this.peek() === "]") {
        this.i += 1;
        return { type: "array", items };
      }
      this.bad();
    }
  }

  parseObject() {
    this.expect("{");
    this.skipWs();
    const entries = [];
    const seen = new Set();
    if (this.peek() === "}") {
      this.i += 1;
      return { type: "object", entries };
    }
    while (true) {
      this.skipWs();
      if (this.peek() !== '"') {
        this.bad();
      }
      const key = this.parseString();
      if (seen.has(key)) {
        this.bad(`Duplicate key "${key}".`);
      }
      seen.add(key);
      this.skipWs();
      this.expect(":");
      this.skipWs();
      const value = this.parseValue();
      entries.push({ key, value });
      this.skipWs();
      if (this.peek() === ",") {
        this.i += 1;
        this.skipWs();
        if (this.peek() === "}") {
          this.bad();
        }
        continue;
      }
      if (this.peek() === "}") {
        this.i += 1;
        return { type: "object", entries };
      }
      this.bad();
    }
  }
}

function fail(error) {
  return { ok: false, error };
}

function integerField(name, node) {
  if (!node || node.type !== "integer") {
    return fail(`Field "${name}" must be an integer.`);
  }
  return { ok: true, value: BigInt(node.lexeme) };
}

function validateAddCall(value) {
  if (value.type !== "object") {
    return fail("Completion must be a JSON object.");
  }
  const keys = value.entries.map((entry) => entry.key);
  const allowed = new Set(["tool", "a", "b"]);
  if (keys.length !== 3 || keys.some((key) => !allowed.has(key))) {
    return fail('Completion must be a JSON object with keys "tool", "a", and "b" only.');
  }
  const fields = Object.fromEntries(value.entries.map((entry) => [entry.key, entry.value]));
  if (fields.tool.type !== "string" || fields.tool.value !== "add") {
    return fail('Field "tool" must be the string "add".');
  }
  const a = integerField("a", fields.a);
  if (!a.ok) {
    return a;
  }
  const b = integerField("b", fields.b);
  if (!b.ok) {
    return b;
  }
  return { ok: true, a: a.value, b: b.value };
}

export function parseAddCall(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return fail("Completion is empty.");
  }
  const source = text.trim();
  if (!source.startsWith("{")) {
    return fail("Completion must be a JSON object.");
  }
  const scanner = new Scanner(source);
  let value;
  try {
    value = scanner.parseValue();
    scanner.skipWs();
    if (!scanner.eof()) {
      return fail("Completion has extra text after the call record.");
    }
  } catch (err) {
    if (err instanceof CallSyntaxError) {
      return fail(err.message);
    }
    throw err;
  }
  return validateAddCall(value);
}
