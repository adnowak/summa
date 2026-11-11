export const STATEMENT_INDEX = "knowledge";
export const STATEMENT_ID = "statement";

const MISSING_URL = "OPENSEARCH_URL is not set in the server environment.";

export function opensearchConfigFromEnv(env = process.env) {
  return {
    url: (env.OPENSEARCH_URL || "").replace(/\/$/, ""),
    username: env.OPENSEARCH_USERNAME || "",
    password: env.OPENSEARCH_PASSWORD || "",
  };
}

export function cleanStatement(body) {
  if (!body || typeof body.label !== "string" || typeof body.text !== "string") {
    return { error: "Request body must be JSON with label and text." };
  }
  const label = body.label.trim();
  const text = body.text.trim();
  if (!label) {
    return { error: "label is required." };
  }
  if (!text) {
    return { error: "text is required." };
  }
  return { statement: { label, text } };
}

function headers(config) {
  const result = { "Content-Type": "application/json" };
  if (config.username) {
    const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    result.Authorization = `Basic ${token}`;
  }
  return result;
}

function documentUrl(config) {
  return `${config.url}/${STATEMENT_INDEX}/_doc/${STATEMENT_ID}`;
}

function failure(status, error) {
  return { ok: false, status, error };
}

function opensearchDetail(data, statusText) {
  const err = data && data.error;
  if (!err) {
    return statusText || "request failed";
  }
  if (typeof err === "string") {
    return err;
  }
  return err.reason || err.type || statusText || "request failed";
}

async function interpret(response) {
  if (response.status === 404) {
    return { ok: true, statement: null };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return failure(502, "OpenSearch returned a non-JSON response.");
  }
  if (!response.ok) {
    return failure(502, `OpenSearch error: ${opensearchDetail(data, response.statusText)}`);
  }
  if (data.found === false) {
    return { ok: true, statement: null };
  }
  const source = data._source;
  if (!source || typeof source.label !== "string" || typeof source.text !== "string") {
    return failure(502, "OpenSearch returned a statement without label and text.");
  }
  return { ok: true, statement: { label: source.label, text: source.text } };
}

export async function readStatement(config, fetchImpl = fetch) {
  if (!config.url) {
    return failure(500, MISSING_URL);
  }
  try {
    const response = await fetchImpl(documentUrl(config), { headers: headers(config) });
    return await interpret(response);
  } catch (err) {
    return failure(502, `Failed to reach OpenSearch: ${err.message}`);
  }
}

export async function writeStatement(config, statement, fetchImpl = fetch) {
  if (!config.url) {
    return failure(500, MISSING_URL);
  }
  const url = `${documentUrl(config)}?refresh=wait_for`;
  try {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: headers(config),
      body: JSON.stringify({ label: statement.label, text: statement.text }),
    });
    if (response.status === 200 || response.status === 201) {
      if (typeof response.arrayBuffer === "function") {
        await response.arrayBuffer();
      }
      return { ok: true, statement: { label: statement.label, text: statement.text } };
    }
    return await interpret(response);
  } catch (err) {
    return failure(502, `Failed to reach OpenSearch: ${err.message}`);
  }
}
