'use strict';

const config = require('./config');
const sched = require('./scheduling');

/**
 * Tool definitions in Anthropic's tool-use format. The model decides when to
 * call them; `executeTool` runs them against the store and returns JSON.
 */
const TOOL_DEFINITIONS = [
  {
    name: 'list_services',
    description: 'Lista los servicios del taller con su duración y rango de precio orientativo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_quote',
    description: 'Devuelve el precio orientativo (rango) y la duración de un servicio.',
    input_schema: {
      type: 'object',
      properties: { service_id: { type: 'string', enum: config.services.map((s) => s.id) } },
      required: ['service_id'],
    },
  },
  {
    name: 'check_availability',
    description:
      'Devuelve las horas libres para un servicio en una fecha. Si no hay huecos ese día, devuelve también los próximos días con disponibilidad.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string', enum: config.services.map((s) => s.id) },
        date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      },
      required: ['service_id', 'date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Reserva una cita. Solo llamar cuando el cliente haya confirmado servicio, fecha, hora, nombre y teléfono.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string', enum: config.services.map((s) => s.id) },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM, una de las horas devueltas por check_availability' },
        customer_name: { type: 'string' },
        phone: { type: 'string' },
        vehicle: { type: 'string', description: 'Marca, modelo y matrícula si la da' },
        notes: { type: 'string', description: 'Síntomas o comentarios del cliente' },
      },
      required: ['service_id', 'date', 'time', 'customer_name', 'phone'],
    },
  },
  {
    name: 'find_appointments',
    description: 'Busca las citas activas asociadas a un número de teléfono.',
    input_schema: {
      type: 'object',
      properties: { phone: { type: 'string' } },
      required: ['phone'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela una cita. Requiere el código de la cita y el teléfono con el que se reservó.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'Código tipo CITA-0001' },
        phone: { type: 'string' },
      },
      required: ['appointment_id', 'phone'],
    },
  },
];

function publicAppointment(a) {
  return {
    id: a.id,
    service: a.serviceName,
    date: a.date,
    date_readable: sched.formatDate(a.date),
    time: a.time,
    customer_name: a.customer.name,
    vehicle: a.vehicle || undefined,
  };
}

/** Runs a tool and always returns a plain object (errors included) so the model can react. */
function executeTool(store, name, input = {}, { now } = {}) {
  const opts = now ? { now } : {};
  try {
    switch (name) {
      case 'list_services':
        return {
          services: config.services.map((s) => ({
            id: s.id, name: s.name, duration_min: s.durationMin,
            price: `${s.priceFrom}-${s.priceTo} €`, note: s.note,
          })),
        };
      case 'get_quote':
        return sched.getQuote(input.service_id);
      case 'check_availability': {
        const slots = sched.getAvailableSlots(store, input.date, input.service_id, opts);
        const out = { date: input.date, date_readable: sched.formatDate(input.date), available_times: slots };
        if (!slots.length) {
          out.next_available = sched
            .findNextAvailable(store, input.service_id, sched.addDays(input.date, 1), { ...opts, days: 3 })
            .map((d) => ({ date: d.date, date_readable: sched.formatDate(d.date), first_times: d.slots.slice(0, 5) }));
        }
        return out;
      }
      case 'book_appointment': {
        const a = sched.bookAppointment(store, {
          serviceId: input.service_id, date: input.date, time: input.time,
          customerName: input.customer_name, phone: input.phone,
          vehicle: input.vehicle, notes: input.notes,
        }, opts);
        return { ok: true, appointment: publicAppointment(a) };
      }
      case 'find_appointments':
        return { appointments: store.byPhone(input.phone).map(publicAppointment) };
      case 'cancel_appointment': {
        const a = sched.cancelAppointment(store, input.appointment_id, input.phone);
        return { ok: true, cancelled: publicAppointment(a) };
      }
      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  } catch (err) {
    if (err instanceof sched.SchedulingError) return { error: err.message };
    throw err;
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
