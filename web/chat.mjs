import {
  add,
  addCallResponseFormat,
  INVALID_ADD_CALL_ERROR,
  MAX_REPAIRS,
  parseAddCall,
  repairInstruction,
  SYSTEM_PROMPT,
} from "./add-call.mjs";

export function completionBody(model, messages) {
  return {
    model,
    messages,
    stream: false,
    response_format: addCallResponseFormat,
    provider: { require_parameters: true },
  };
}

function upstreamErrorDetail(data, statusText) {
  return (data && (data.error?.message || data.error)) || statusText;
}

export function citationInstructions(statement) {
  return [
    `Label: ${statement.label}`,
    `Text: ${statement.text}`,
    "If the subject of the user message semantically fits the label, include the label and the text exactly in the reply.",
    "If the subject does not semantically fit the label, include neither the label nor the text in the reply.",
  ].join("\n");
}

async function complete({ apiKey, baseUrl, referer, appTitle, body, fetchImpl }) {
  let upstream;
  try {
    upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": appTitle,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: `Failed to reach the external LLM: ${err.message}` },
    };
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return { ok: false, status: 502, body: { error: "External LLM returned a non-JSON response." } };
  }

  if (!upstream.ok) {
    const detail = upstreamErrorDetail(data, upstream.statusText);
    return { ok: false, status: 502, body: { error: `External LLM error: ${detail}` } };
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  return { ok: true, text };
}

async function runCitation(options, statement) {
  const messages = [
    { role: "system", content: citationInstructions(statement) },
    { role: "user", content: options.message },
  ];
  const result = await complete({
    ...options,
    body: {
      model: options.model,
      messages,
      stream: false,
    },
  });
  if (!result.ok) {
    return { status: result.status, body: result.body };
  }
  if (!result.text.trim()) {
    return { status: 502, body: { error: "External LLM returned no reply text." } };
  }
  return { status: 200, body: { reply: result.text } };
}

export async function runChat({
  message,
  apiKey,
  model,
  baseUrl,
  referer,
  appTitle,
  statement = null,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "OPENROUTER_API_KEY is not set in the server environment." },
    };
  }

  const options = { message, apiKey, model, baseUrl, referer, appTitle, fetchImpl };
  if (statement) {
    return runCitation(options, statement);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  let repairsUsed = 0;

  for (;;) {
    const result = await complete({
      ...options,
      body: completionBody(model, messages),
    });
    if (!result.ok) {
      return { status: result.status, body: result.body };
    }
    const parsed = parseAddCall(result.text);
    if (parsed.ok) {
      return { status: 200, body: { reply: add(parsed.a, parsed.b).toString() } };
    }
    if (repairsUsed === MAX_REPAIRS) {
      return { status: 502, body: { error: INVALID_ADD_CALL_ERROR } };
    }
    repairsUsed += 1;
    messages.push(
      { role: "assistant", content: result.text },
      { role: "user", content: repairInstruction(parsed.error) },
    );
  }
}
