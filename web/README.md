# Summa web (spike s1)

One-shot page: send a message, show one reply from OpenRouter (OpenAI-compatible chat completions).

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

Open http://127.0.0.1:3000, enter one message, Send. The reply appears under **Reply**.

The page does not edit the endpoint, model, or key. Replies are not streamed. There is no second turn or stored transcript.
