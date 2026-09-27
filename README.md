# Taller Appointment Agent

An AI booking assistant for a car workshop. Customers chat in natural language to get indicative prices, check free slots, book, look up and cancel appointments. Built on **Claude tool use**, with an **offline demo mode** so anyone can run it without an API key.

> Part 1 of a 4-part workshop automation suite (bookings → quotes → customer queries → Stripe payments). Channels planned: web (this repo), WhatsApp and voice.

## What it does

- 💬 Web chat (mobile-friendly, light/dark) served by the same Node process
- 🔧 6 tools the model can call: `list_services`, `get_quote`, `check_availability`, `book_appointment`, `find_appointments`, `cancel_appointment`
- 📅 Real scheduling rules: opening hours with lunch break, Saturday mornings, several service bays working in parallel, service durations, 1-hour notice for same-day bookings, max 30 days ahead
- 🛡️ Guardrails in the system prompt: never invent prices or slots, confirm before booking, no mechanical diagnosis, "do not drive" warning for safety symptoms
- 🔐 Cancellation requires the phone used to book; the agenda endpoint can be protected with a token
- 🧪 21 tests (`node:test`), including the Claude tool-use loop with a mocked API
- 📦 **Zero dependencies**: only Node.js. Talks to the Anthropic Messages API with the built-in `fetch`

## Quick start

Requires **Node.js 20.12+** (`node -v`).

```bash
git clone https://github.com/bassj66/taller-appointment-agent.git
cd taller-appointment-agent
npm test          # run the test suite
npm start         # start the server
```

Open **http://localhost:3000** and try:

- "¿Qué servicios tenéis?"
- "¿Cuánto cuesta el cambio de aceite?"
- "Quiero una revisión el jueves" → "a las 16:00" → "soy Luigi" → "612345678"
- "mis citas" / "cancelar CITA-0001"

See the agenda at http://localhost:3000/api/appointments

### Using real AI (Claude)

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm start
```

The header badge switches from **Modo demo** to **IA: Claude**. Without a key, a rule-based agent answers using the **same tools and business logic**, which keeps the app demo-able and testable offline.

## Architecture

```
public/index.html        Chat UI (vanilla JS)
src/server.js            HTTP API (node:http): /api/chat, /api/services, /api/appointments, /api/health
src/agent.js             ClaudeAgent (tool-use loop, per-session history) + DemoAgent (offline)
src/tools.js             Tool JSON schemas + executor (errors returned as data so the model can recover)
src/scheduling.js        Availability, booking, cancellation, quotes — pure business logic
src/store.js             JSON-file store (swap for Postgres/Supabase/Airtable)
src/anthropic-client.js  Minimal Messages API client (same shape as the official SDK)
src/config.js            Workshop data: hours, bays, services, prices
```

Flow of a message:

```
user ─▶ POST /api/chat ─▶ agent.reply()
                            │
                            ├─▶ Claude: text?  ──▶ reply to user
                            └─▶ Claude: tool_use ─▶ executeTool() ─▶ scheduling + store
                                     ▲                                   │
                                     └──────────── tool_result ◀─────────┘
```

## API

| Method | Path | Body / query | Description |
|---|---|---|---|
| POST | `/api/chat` | `{ sessionId, message }` | Returns `{ reply, toolCalls, mode }` |
| POST | `/api/chat/reset` | `{ sessionId }` | Clears the conversation |
| GET | `/api/services` | | Workshop info and services |
| GET | `/api/appointments` | `?date=YYYY-MM-DD` | Agenda (needs `x-admin-token` header if `ADMIN_TOKEN` is set) |
| GET | `/api/health` | | `{ ok, mode }` |

```bash
curl -s localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"test","message":"¿Cuánto vale la pre-ITV?"}'
```

## Adapting it to a real workshop

Edit `src/config.js`: name, address, opening hours, number of bays, services with duration and price range. No other change needed.

## Roadmap

- [ ] WhatsApp channel (WhatsApp Cloud API webhook → same `agent.reply()`)
- [ ] Voice channel (Twilio / Vapi)
- [ ] Stripe deposit on booking
- [ ] Reminder the day before (cron + WhatsApp)
- [ ] Persistent DB and admin panel

## License

MIT
