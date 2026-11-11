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

export async function runChat({
  message,
  apiKey,
  model,
  baseUrl,
  referer,
  appTitle,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "OPENROUTER_API_KEY is not set in the server environment." },
    };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  let repairsUsed = 0;

  for (;;) {
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
        body: JSON.stringify(completionBody(model, messages)),
      });
    } catch (err) {
      return {
        status: 502,
        body: { error: `Failed to reach the external LLM: ${err.message}` },
      };
    }

    let data;
    try {
      data = await upstream.json();
    } catch {
      return { status: 502, body: { error: "External LLM returned a non-JSON response." } };
    }

    if (!upstream.ok) {
      const detail = upstreamErrorDetail(data, upstream.statusText);
      return { status: 502, body: { error: `External LLM error: ${detail}` } };
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    const parsed = parseAddCall(text);
    if (parsed.ok) {
      return { status: 200, body: { reply: add(parsed.a, parsed.b).toString() } };
    }
    if (repairsUsed === MAX_REPAIRS) {
      return { status: 502, body: { error: INVALID_ADD_CALL_ERROR } };
    }
    repairsUsed += 1;
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: repairInstruction(parsed.error) },
    );
  }
}
