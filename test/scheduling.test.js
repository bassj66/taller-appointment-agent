'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppointmentStore } = require('../src/store');
const sched = require('../src/scheduling');
const config = require('../src/config');

// Fixed clock: Monday 5 Oct 2026, 08:00 in the workshop.
const now = { date: '2026-10-05', time: '08:00' };
const MONDAY = '2026-10-05';
const TUESDAY = '2026-10-06';
const SATURDAY = '2026-10-10';
const SUNDAY = '2026-10-11';

const newStore = () => new AppointmentStore({ file: null });
const book = (store, extra = {}) =>
  sched.bookAppointment(store, {
    serviceId: 'cambio-aceite', date: TUESDAY, time: '09:00',
    customerName: 'Ana', phone: '612345678', ...extra,
  }, { now });

test('weekday slots respect the lunch break and closing time', () => {
  const slots = sched.getAvailableSlots(newStore(), TUESDAY, 'revision', { now }); // 60 min
  assert.equal(slots[0], '09:00');
  assert.ok(slots.includes('13:00'));
  assert.ok(!slots.includes('13:30'), '13:30 + 60 min would run into lunch');
  assert.ok(!slots.includes('14:00'));
  assert.ok(slots.includes('15:30'));
  assert.equal(slots.at(-1), '18:00');
});

test('Saturday has morning hours only and Sunday is closed', () => {
  const sat = sched.getAvailableSlots(newStore(), SATURDAY, 'cambio-aceite', { now });
  assert.equal(sat.at(-1), '12:30');
  assert.deepEqual(sched.getAvailableSlots(newStore(), SUNDAY, 'cambio-aceite', { now }), []);
});

test('same-day bookings need at least one hour of notice', () => {
  const slots = sched.getAvailableSlots(newStore(), MONDAY, 'cambio-aceite', { now: { date: MONDAY, time: '10:10' } });
  assert.ok(!slots.includes('11:00'));
  assert.equal(slots[0], '11:30');
});

test('past dates return no slots and far dates are rejected', () => {
  assert.deepEqual(sched.getAvailableSlots(newStore(), '2026-10-01', 'revision', { now }), []);
  assert.throws(() => sched.getAvailableSlots(newStore(), '2026-12-31', 'revision', { now }), /antelación/);
});

test('invalid dates and services are rejected', () => {
  assert.throws(() => sched.getAvailableSlots(newStore(), '2026-02-30', 'revision', { now }), /Fecha no válida/);
  assert.throws(() => sched.getAvailableSlots(newStore(), TUESDAY, 'pintura', { now }), /Servicio desconocido/);
});

test(`a slot stays open until all ${config.bays} bays are taken`, () => {
  const store = newStore();
  book(store);
  assert.ok(sched.getAvailableSlots(store, TUESDAY, 'cambio-aceite', { now }).includes('09:00'));
  book(store, { customerName: 'Luis', phone: '698765432' });
  assert.ok(!sched.getAvailableSlots(store, TUESDAY, 'cambio-aceite', { now }).includes('09:00'));
});

test('a long service is blocked if any part of it overlaps a full slot', () => {
  const store = newStore();
  book(store, { time: '09:30' });
  book(store, { time: '09:30', phone: '698765432' });
  const slots = sched.getAvailableSlots(store, TUESDAY, 'revision', { now }); // 60 min
  assert.ok(!slots.includes('09:00'), '09:00-10:00 overlaps the full 09:30 slot');
  assert.ok(slots.includes('10:00'));
});

test('booking stores the appointment with an incremental id', () => {
  const store = newStore();
  const a = book(store);
  assert.equal(a.id, 'CITA-0001');
  assert.equal(a.status, 'confirmed');
  assert.equal(book(store, { time: '10:00' }).id, 'CITA-0002');
});

test('booking validates name, phone and slot', () => {
  const store = newStore();
  assert.throws(() => book(store, { customerName: ' ' }), /nombre/);
  assert.throws(() => book(store, { phone: '123' }), /teléfono/);
  assert.throws(() => book(store, { time: '14:00' }), /no está disponible/);
});

test('cancellation requires the phone used to book and frees the slot', () => {
  const store = newStore();
  const a = book(store);
  book(store, { phone: '698765432' });
  assert.throws(() => sched.cancelAppointment(store, a.id, '600000000'), /no coincide/);
  sched.cancelAppointment(store, a.id, '+34 612 345 678');
  assert.equal(store.get(a.id).status, 'cancelled');
  assert.ok(sched.getAvailableSlots(store, TUESDAY, 'cambio-aceite', { now }).includes('09:00'));
  assert.throws(() => sched.cancelAppointment(store, a.id, '612345678'), /No existe/);
});

test('findNextAvailable skips closed days', () => {
  const days = sched.findNextAvailable(newStore(), 'cambio-aceite', SATURDAY, { now, days: 2 });
  assert.equal(days[0].date, SATURDAY);
  assert.equal(days[1].date, '2026-10-12'); // Sunday skipped
});

test('matchService understands everyday wording', () => {
  assert.equal(sched.matchService('me chirrían los frenos').id, 'frenos');
  assert.equal(sched.matchService('se me ha encendido un testigo').id, 'diagnosis');
  assert.equal(sched.matchService('quiero pasar la ITV').id, 'pre-itv');
  assert.equal(sched.matchService('hola'), null);
});
