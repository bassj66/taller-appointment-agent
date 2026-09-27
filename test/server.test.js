'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');
const { AppointmentStore } = require('../src/store');
const { DemoAgent } = require('../src/agent');

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP API: health, services, chat, agenda and static page', async () => {
  const store = new AppointmentStore({ file: null });
  const agent = new DemoAgent({ store, now: { date: '2026-10-05', time: '08:00' } });

  await withServer({ store, agent, adminToken: '' }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, mode: 'demo' });

    const services = await (await fetch(`${base}/api/services`)).json();
    assert.ok(services.services.length >= 5);

    const chat = await (await post(`${base}/api/chat`, { sessionId: 'x', message: 'Pre-ITV el 06/10 a las 10:00, soy Ana, 612345678' })).json();
    assert.match(chat.reply, /Reservado/);

    const agenda = await (await fetch(`${base}/api/appointments?date=2026-10-06`)).json();
    assert.equal(agenda.appointments.length, 1);

    const page = await fetch(`${base}/`);
    assert.match(page.headers.get('content-type'), /text\/html/);
  });
});

test('HTTP API validates input and protects the agenda', async () => {
  const store = new AppointmentStore({ file: null });
  await withServer({ store, agent: new DemoAgent({ store }), adminToken: 'secret' }, async (base) => {
    assert.equal((await post(`${base}/api/chat`, { message: 'hola' })).status, 400);
    const bad = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/appointments`)).status, 401);
    assert.equal((await fetch(`${base}/api/appointments`, { headers: { 'x-admin-token': 'secret' } })).status, 200);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  });
});
