# Summa web (spike s3)

One page. It saves one statement, and it sends one message.

The statement has a label and a text. It is one OpenSearch document: index `knowledge`, id `statement`, fields `label` and `text`. Save replaces that document. With no document stored, a message asks to add two integers. The server asks the external LLM for one JSON call record, calls local `add` with those integers as `bigint`, and shows the decimal digits of the sum. With a statement stored, the server sends one completion that includes the label, the text, and the citation rule. The page shows the model reply. A citation is exact: the reply contains the stored label and the stored text. When the subject does not fit the label, those strings are absent.

## Run

```bash
docker compose up -d
cd web
export OPENROUTER_API_KEY=sk-or-...
export OPENSEARCH_URL=http://127.0.0.1:9200
# optional:
# export OPENSEARCH_USERNAME=...
# export OPENSEARCH_PASSWORD=...
# export OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# export OPENROUTER_MODEL=openai/gpt-4o-mini
# export PORT=3000
npm start
```

Open http://127.0.0.1:3000. Save a label and a text, confirm both are shown, edit them, and confirm the new values. Ask a question whose subject fits the label and confirm the reply contains the label and the text exactly. Ask a question whose subject does not fit and confirm the reply contains neither string.

The page does not edit the endpoint, the model, the key, or the cluster URL. Replies are not streamed. There is no stored transcript and no search. The add path still uses OpenRouter structured outputs (`response_format` JSON Schema `add_call`, `strict: true`, `provider.require_parameters: true`). `a` and `b` are read from the raw completion text so large integers stay exact. A completion that is not the call record is sent back to the model for up to 3 repairs. After that, `POST /api/chat` returns `502` and `{"error":"The model did not return a valid add call."}`. That path runs only when OpenSearch has no statement.

## Local checks

```bash
cd web
npm test
```

Tests use a mock completion endpoint and a mock OpenSearch. They do not call a live model or a live cluster.

The two citation checks above need a live model and a live cluster. Run those yourself.
