'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppointmentStore } = require('../src/store');
const { DemoAgent, ClaudeAgent, parseDate, parseTime, parsePhone, parseName } = require('../src/agent');
const { executeTool, TOOL_DEFINITIONS } = require('../src/tools');

const now = { date: '2026-10-05', time: '08:00' }; // Monday

test('parsers handle common Spanish phrasing', () => {
  assert.equal(parseDate('mañana', now.date), '2026-10-06');
  assert.equal(parseDate('pasado mañana', now.date), '2026-10-07');
  assert.equal(parseDate('el jueves', now.date), '2026-10-08');
  assert.equal(parseDate('el lunes', now.date), '2026-10-12', 'same weekday means next week');
  assert.equal(parseDate('el 15/10', now.date), '2026-10-15');
  assert.equal(parseDate('31/02', now.date), null);
  assert.equal(parseTime('a las 10'), '10:00');
  assert.equal(parseTime('a las 16:30'), '16:30');
  assert.equal(parsePhone('mi móvil es 612 345 678'), '612 345 678');
  assert.equal(parsePhone('el 2026-10-15'), null);
  assert.equal(parseName('me llamo luigi'), 'Luigi');
  assert.equal(parseName('Soy Ana García'), 'Ana García');
});

test('demo agent completes a booking over several turns', async () => {
  const store = new AppointmentStore({ file: null });
  const agent = new DemoAgent({ store, now });
  const s = 'session-1';

  let r = await agent.reply(s, 'Hola, necesito cambiar el aceite');
  assert.match(r.reply, /Qué día/);

  r = await agent.reply(s, 'mañana');
  assert.match(r.reply, /09:00/);
  assert.equal(r.toolCalls[0].name, 'check_availability');

  r = await agent.reply(s, 'a las 10:00');
  assert.match(r.reply, /nombre/);

  r = await agent.reply(s, 'me llamo Luigi');
  assert.match(r.reply, /teléfono/);

  r = await agent.reply(s, '612 345 678');
  assert.match(r.reply, /Reservado/);
  assert.match(r.reply, /CITA-0001/);
  assert.equal(store.active().length, 1);
  assert.equal(store.active()[0].time, '10:00');
});

test('demo agent answers prices, lists and cancels', async () => {
  const store = new AppointmentStore({ file: null });
  const agent = new DemoAgent({ store, now });

  let r = await agent.reply('a', '¿Cuánto cuesta cambiar las pastillas de freno?');
  assert.match(r.reply, /80 y 160 €/);

  r = await agent.reply('b', '¿Qué servicios tenéis?');
  assert.match(r.reply, /Pre-ITV/);

  await agent.reply('c', 'Revisión el 06/10 a las 09:00, soy Marta, tel 698 765 432');
  r = await agent.reply('c', 'mis citas');
  assert.match(r.reply, /CITA-0001/);

  r = await agent.reply('c', 'cancelar CITA-0001');
  assert.match(r.reply, /cancelada/);
  assert.equal(store.active().length, 0);
});

test('demo agent offers other days when the chosen one is closed', async () => {
  const agent = new DemoAgent({ store: new AppointmentStore({ file: null }), now });
  const r = await agent.reply('s', 'diagnosis el domingo');
  assert.match(r.reply, /no quedan huecos/);
  assert.match(r.reply, /lunes 12\/10\/2026/);
});

test('tool errors come back as data, not exceptions', () => {
  const out = executeTool(new AppointmentStore({ file: null }), 'check_availability', { service_id: 'revision', date: 'ayer' }, { now });
  assert.match(out.error, /Fecha no válida/);
});

test('tool schemas are valid for the Messages API', () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.name && t.description);
    assert.equal(t.input_schema.type, 'object');
  }
});

test('Claude agent runs the tool-use loop until a text answer', async () => {
  const calls = [];
  const fakeClient = {
    messages: {
      create: async (body) => {
        calls.push(body);
        if (calls.length === 1) {
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tu_1', name: 'get_quote', input: { service_id: 'pre-itv' } }],
          };
        }
        const toolResult = body.messages.at(-1).content[0];
        assert.equal(toolResult.type, 'tool_result');
        assert.equal(JSON.parse(toolResult.content).priceFrom, 35);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'La pre-ITV cuesta entre 35 y 50 €.' }] };
      },
    },
  };

  const agent = new ClaudeAgent({ store: new AppointmentStore({ file: null }), client: fakeClient, model: 'test-model' });
  const r = await agent.reply('s', '¿Cuánto vale la pre-ITV?');
  assert.equal(r.reply, 'La pre-ITV cuesta entre 35 y 50 €.');
  assert.equal(r.toolCalls[0].name, 'get_quote');
  assert.equal(calls[0].model, 'test-model');
  assert.match(calls[0].system, /Hoy es/);
  assert.equal(calls[0].tools.length, TOOL_DEFINITIONS.length);
});
