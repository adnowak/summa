# Summa web (spike s2)

One-shot page: ask to add two integers. The server asks the external LLM for one JSON call record, calls local `add` with those integers as `bigint`, and shows the decimal digits of the sum.

## Run

```bash
cd web
export OPENROUTER_API_KEY=sk-or-...
# optional:
# export OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# export OPENROUTER_MODEL=openai/gpt-4o-mini
# export PORT=3000
npm start
```

Open http://127.0.0.1:3000. Ask to add the same two integers twice. Both replies show that sum.

The page does not edit the endpoint, model, key, or tools. Replies are not streamed. There is no stored transcript. The chat request uses OpenRouter structured outputs (`response_format` JSON Schema `add_call`, `strict: true`, `provider.require_parameters: true`). `a` and `b` are read from the raw completion text so large integers stay exact. A completion that is not the call record is sent back to the model for up to 3 repairs. After that, `POST /api/chat` returns `502` and `{"error":"The model did not return a valid add call."}`.

## Local checks

```bash
cd web
npm test
```

Tests use a mock completion endpoint. They do not call a live model.
