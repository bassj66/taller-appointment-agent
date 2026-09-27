'use strict';

const config = require('./config');
const { normalisePhone } = require('./store');

class SchedulingError extends Error {}

// ---------- time helpers (dates are 'YYYY-MM-DD', times are 'HH:MM', workshop local time) ----------

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
}

/** Current date and time in the workshop's timezone. */
function nowLocal(tz = config.workshop.timezone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function formatDate(date) {
  const [y, m, d] = date.split('-');
  return `${DAY_NAMES[weekday(date)]} ${Number(d)}/${Number(m)}/${y}`;
}

// ---------- services ----------

function getService(serviceId) {
  const s = config.services.find((x) => x.id === serviceId);
  if (!s) {
    throw new SchedulingError(
      `Servicio desconocido "${serviceId}". Servicios válidos: ${config.services.map((x) => x.id).join(', ')}`
    );
  }
  return s;
}

/** Best-effort match of free text ("me pita el testigo", "cambiar ruedas") to a service. */
function matchService(text) {
  const t = text.toLowerCase();
  return config.services.find((s) => s.keywords.some((k) => t.includes(k))) || null;
}

// ---------- availability ----------

/**
 * Returns the start times on `date` where `serviceId` fits entirely inside an
 * opening range and no more than `bays` cars overlap at any moment.
 */
function getAvailableSlots(store, date, serviceId, { now = nowLocal() } = {}) {
  if (!isValidDate(date)) throw new SchedulingError(`Fecha no válida "${date}". Usa el formato AAAA-MM-DD.`);
  const service = getService(serviceId);

  const ahead = daysBetween(now.date, date);
  if (ahead < 0) return [];
  if (ahead > config.maxDaysAhead) {
    throw new SchedulingError(`Solo se puede reservar con un máximo de ${config.maxDaysAhead} días de antelación.`);
  }

  const ranges = config.openingHours[weekday(date)] || [];
  const booked = store.onDate(date).map((a) => ({
    start: toMinutes(a.time),
    end: toMinutes(a.time) + a.durationMin,
  }));

  const earliest = ahead === 0 ? toMinutes(now.time) + 60 : 0; // same-day: at least 1h notice
  const slots = [];

  for (const [open, close] of ranges) {
    for (let start = toMinutes(open); start + service.durationMin <= toMinutes(close); start += config.slotMinutes) {
      if (start < earliest) continue;
      const end = start + service.durationMin;
      if (maxOverlap(booked, start, end) < config.bays) slots.push(toHHMM(start));
    }
  }
  return slots;
}

/** Highest number of existing appointments running at the same time within [start, end). */
function maxOverlap(booked, start, end) {
  let max = 0;
  for (let t = start; t < end; t += config.slotMinutes) {
    const count = booked.filter((b) => b.start < t + config.slotMinutes && b.end > t).length;
    max = Math.max(max, count);
  }
  return max;
}

/** Scans forward from `fromDate` and returns the first days that have room. */
function findNextAvailable(store, serviceId, fromDate, { days = 3, now = nowLocal() } = {}) {
  const result = [];
  for (let i = 0; i <= config.maxDaysAhead && result.length < days; i++) {
    const date = addDays(fromDate, i);
    if (daysBetween(now.date, date) > config.maxDaysAhead) break;
    const slots = getAvailableSlots(store, date, serviceId, { now });
    if (slots.length) result.push({ date, slots });
  }
  return result;
}

// ---------- booking ----------

function bookAppointment(store, { serviceId, date, time, customerName, phone, vehicle = '', notes = '' }, { now = nowLocal() } = {}) {
  if (!customerName || !customerName.trim()) throw new SchedulingError('Falta el nombre del cliente.');
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) throw new SchedulingError('Falta un teléfono válido (mínimo 9 dígitos).');

  const service = getService(serviceId);
  const slots = getAvailableSlots(store, date, serviceId, { now });
  if (!slots.includes(time)) {
    throw new SchedulingError(
      slots.length
        ? `La hora ${time} no está disponible el ${formatDate(date)}. Horas libres: ${slots.join(', ')}.`
        : `No quedan huecos para ${service.name} el ${formatDate(date)}.`
    );
  }

  return store.add({
    id: store.nextId(),
    status: 'confirmed',
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    date,
    time,
    customer: { name: customerName.trim(), phone: String(phone).trim() },
    vehicle: vehicle.trim(),
    notes: notes.trim(),
    createdAt: new Date().toISOString(),
  });
}

function cancelAppointment(store, id, phone) {
  const a = store.get(id);
  if (!a || a.status !== 'confirmed') throw new SchedulingError(`No existe ninguna cita activa con código ${id}.`);
  // Light identity check: the caller must know the phone used to book.
  if (normalisePhone(a.customer.phone) !== normalisePhone(phone)) {
    throw new SchedulingError('El teléfono no coincide con el de la reserva.');
  }
  return store.update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
}

function getQuote(serviceId) {
  const s = getService(serviceId);
  return {
    serviceId: s.id,
    service: s.name,
    priceFrom: s.priceFrom,
    priceTo: s.priceTo,
    currency: 'EUR',
    durationMin: s.durationMin,
    note: s.note || 'Precio orientativo con IVA; el presupuesto final depende del vehículo.',
  };
}

module.exports = {
  SchedulingError,
  nowLocal,
  isValidDate,
  addDays,
  weekday,
  formatDate,
  getService,
  matchService,
  getAvailableSlots,
  findNextAvailable,
  bookAppointment,
  cancelAppointment,
  getQuote,
};
