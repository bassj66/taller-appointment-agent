'use strict';

const config = require('./config');
const sched = require('./scheduling');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_MESSAGES = 30;

function systemPrompt(now = sched.nowLocal()) {
  const w = config.workshop;
  return `Eres el asistente de reservas de ${w.name} (${w.address}, tel. ${w.phone}).
Hoy es ${sched.formatDate(now.date)} (${now.date}) y son las ${now.time}, hora de ${w.timezone}.

Tu trabajo: informar de servicios y precios orientativos, consultar disponibilidad, reservar, consultar y cancelar citas.

Reglas:
- Responde en el idioma del cliente (por defecto español), en frases cortas y amables. Estás en un chat.
- Usa SIEMPRE las herramientas para precios y horarios. Nunca inventes horas libres ni precios.
- Convierte fechas relativas ("mañana", "el jueves") a YYYY-MM-DD usando la fecha de hoy.
- Antes de reservar necesitas: servicio, fecha, hora, nombre y teléfono. Pide lo que falte, de uno o dos datos a la vez.
- Resume la cita y pide confirmación antes de llamar a book_appointment.
- Tras reservar, da el código de la cita (CITA-XXXX) y recuerda traer el vehículo 5 minutos antes.
- Los precios son orientativos; el presupuesto final lo da el mecánico al ver el coche.
- No hagas diagnósticos mecánicos. Si el cliente describe frenos que fallan, pérdida de dirección, humo u olor a combustible, dile que no conduzca el coche y que llame al ${w.phone}.
- Si algo no está en tus herramientas (pagos, piezas concretas, recogida del coche), di que lo consultarás con el taller y ofrece el teléfono.`;
}

/**
 * Agent backed by Claude with tool use. Keeps one conversation per sessionId.
 */
class ClaudeAgent {
  constructor({ store, client, model }) {
    this.store = store;
    this.client = client;
    this.model = model;
    this.sessions = new Map();
    this.mode = 'claude';
  }

  async reply(sessionId, userMessage) {
    const history = this.sessions.get(sessionId) || [];
    history.push({ role: 'user', content: userMessage });
    const toolCalls = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt(),
        tools: TOOL_DEFINITIONS,
        messages: history,
      });

      history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        this.sessions.set(sessionId, trimHistory(history));
        return { reply: text, toolCalls };
      }

      const results = response.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          const output = executeTool(this.store, b.name, b.input);
          toolCalls.push({ name: b.name, input: b.input, output });
          return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(output) };
        });
      history.push({ role: 'user', content: results });
    }

    this.sessions.set(sessionId, trimHistory(history));
    return { reply: 'Lo siento, no he podido completar la gestión. ¿Puedes llamarnos al ' + config.workshop.phone + '?', toolCalls };
  }

  reset(sessionId) {
    this.sessions.delete(sessionId);
  }
}

/** Keeps the history short without splitting a tool_use from its tool_result. */
function trimHistory(history) {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  let start = history.length - MAX_HISTORY_MESSAGES;
  while (start < history.length && !(history[start].role === 'user' && typeof history[start].content === 'string')) {
    start++;
  }
  return history.slice(start);
}

// ---------------------------------------------------------------------------
// Demo agent: rule-based, no API key needed. Uses the SAME tools as Claude, so
// the booking logic can be tested end-to-end offline.
// ---------------------------------------------------------------------------

const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function parseDate(text, today) {
  const t = stripAccents(text.toLowerCase());
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (dm) {
    const year = dm[3] || today.slice(0, 4);
    const date = `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    return sched.isValidDate(date) ? date : null;
  }
  if (/pasado manana/.test(t)) return sched.addDays(today, 2);
  if (/\bmanana\b/.test(t)) return sched.addDays(today, 1);
  if (/\bhoy\b/.test(t)) return today;
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const diff = (dow - sched.weekday(today) + 7) % 7 || 7;
      return sched.addDays(today, diff);
    }
  }
  return null;
}

function parseTime(text) {
  const m = text.match(/\b(\d{1,2})[:.h](\d{2})\b/) || text.match(/\ba las (\d{1,2})\b/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parsePhone(text) {
  for (const m of text.matchAll(/(\+?\d[\d\s-]{7,}\d)/g)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(m[1])) continue; // an ISO date, not a phone
    if (m[1].replace(/\D/g, '').length >= 9) return m[1].trim();
  }
  return null;
}

function parseName(text) {
  const m = text.match(/(?:me llamo|soy|mi nombre es|nombre:?)\s+([A-Za-zÀ-ÿ]+)(?:\s+([A-ZÀ-Ý][a-zà-ÿ]+))?/i);
  if (!m) return null;
  const first = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const second = m[2] && /^[A-ZÀ-Ý]/.test(m[2]) ? ` ${m[2]}` : '';
  return first + second;
}

class DemoAgent {
  constructor({ store, now }) {
    this.store = store;
    this.now = now; // optional fixed clock for tests
    this.sessions = new Map();
    this.mode = 'demo';
  }

  _now() {
    return this.now || sched.nowLocal();
  }

  _tool(name, input, toolCalls) {
    const output = executeTool(this.store, name, input, { now: this._now() });
    toolCalls.push({ name, input, output });
    return output;
  }

  async reply(sessionId, message) {
    const s = this.sessions.get(sessionId) || {};
    this.sessions.set(sessionId, s);
    const toolCalls = [];
    const text = message.trim();
    const lower = stripAccents(text.toLowerCase());
    const today = this._now().date;
    const say = (reply) => ({ reply, toolCalls });

    // --- cancel ---
    if (/cancel|anular/.test(lower)) {
      const id = (text.match(/CITA-\d{4}/i) || [])[0];
      const phone = parsePhone(text.replace(/CITA-\d{4}/i, '')) || s.phone;
      if (!id || !phone) return say('Para cancelar necesito el código de la cita (CITA-XXXX) y el teléfono con el que reservaste.');
      const out = this._tool('cancel_appointment', { appointment_id: id.toUpperCase(), phone }, toolCalls);
      return say(out.error ? out.error : `Hecho, la cita ${out.cancelled.id} del ${out.cancelled.date_readable} a las ${out.cancelled.time} está cancelada.`);
    }

    // --- my appointments ---
    if (/mis citas|tengo cita|mi cita/.test(lower)) {
      const phone = parsePhone(text) || s.phone;
      if (!phone) return say('Dime el teléfono con el que reservaste y te busco las citas.');
      const out = this._tool('find_appointments', { phone }, toolCalls);
      if (!out.appointments.length) return say('No encuentro citas activas con ese teléfono.');
      return say('Tus citas:\n' + out.appointments.map((a) => `• ${a.id}: ${a.service}, ${a.date_readable} a las ${a.time}`).join('\n'));
    }

    // --- collect booking data from this message ---
    const service = sched.matchService(text);
    if (service) s.serviceId = service.id;
    const date = parseDate(text, today);
    if (date) { s.date = date; s.time = undefined; }
    const time = parseTime(text);
    if (time) s.time = time;
    const phone = parsePhone(text);
    if (phone) s.phone = phone;
    const name = parseName(text);
    if (name) s.name = name;

    // --- prices / services ---
    if (/precio|cuanto|cuesta|presupuesto|vale/.test(lower)) {
      if (s.serviceId) {
        const q = this._tool('get_quote', { service_id: s.serviceId }, toolCalls);
        return say(`${q.service}: entre ${q.priceFrom} y ${q.priceTo} € (unos ${q.durationMin} min). ${q.note} ¿Quieres pedir cita?`);
      }
    }
    if (/servicio|que haceis|que hac[eé]is|precios/.test(lower) || (!s.serviceId && /precio|cuanto|cuesta/.test(lower))) {
      const out = this._tool('list_services', {}, toolCalls);
      return say('Estos son nuestros servicios:\n' + out.services.map((x) => `• ${x.name} (${x.price})`).join('\n') + '\n¿Cuál necesitas?');
    }

    // --- booking flow ---
    if (!s.serviceId) {
      if (/hola|buenas|buenos/.test(lower)) {
        return say(`¡Hola! Soy el asistente de ${config.workshop.name}. Puedo darte precios, ver huecos y reservar cita. ¿Qué le hacemos al coche?`);
      }
      return say('¿Qué servicio necesitas? Por ejemplo: cambio de aceite, revisión, frenos, neumáticos, diagnosis, pre-ITV o aire acondicionado.');
    }
    if (!s.date) return say(`Perfecto, ${sched.getService(s.serviceId).name}. ¿Qué día te va bien? (p. ej. "mañana", "el jueves" o "15/10")`);

    if (!s.time) {
      const out = this._tool('check_availability', { service_id: s.serviceId, date: s.date }, toolCalls);
      if (out.error) { s.date = undefined; return say(out.error); }
      if (!out.available_times.length) {
        const alt = (out.next_available || []).map((d) => `• ${d.date_readable}: ${d.first_times.join(', ')}`).join('\n');
        s.date = undefined;
        return say(`El ${out.date_readable} no quedan huecos.` + (alt ? `\nPróximos días con disponibilidad:\n${alt}` : ''));
      }
      return say(`El ${out.date_readable} tengo libre: ${out.available_times.join(', ')}. ¿A qué hora te va bien?`);
    }

    if (!s.name) return say('¿A nombre de quién hago la reserva?');
    if (!s.phone) return say(`Gracias, ${s.name}. ¿Me dejas un teléfono de contacto?`);

    const out = this._tool('book_appointment', {
      service_id: s.serviceId, date: s.date, time: s.time, customer_name: s.name, phone: s.phone,
    }, toolCalls);
    if (out.error) { s.time = undefined; return say(out.error); }

    const a = out.appointment;
    this.sessions.set(sessionId, { phone: s.phone, name: s.name }); // keep identity, clear booking
    return say(`¡Reservado! ✅\n${a.service}\n${a.date_readable} a las ${a.time}\nCódigo: ${a.id}\nTrae el coche 5 minutos antes. Para cancelar, escribe "cancelar ${a.id}".`);
  }

  reset(sessionId) {
    this.sessions.delete(sessionId);
  }
}

/** Uses Claude when ANTHROPIC_API_KEY is set, otherwise the offline demo agent. */
function createAgent({ store, apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5' } = {}) {
  if (!apiKey) return new DemoAgent({ store });
  const { AnthropicClient } = require('./anthropic-client');
  return new ClaudeAgent({ store, client: new AnthropicClient({ apiKey }), model });
}

module.exports = { createAgent, ClaudeAgent, DemoAgent, systemPrompt, parseDate, parseTime, parsePhone, parseName };
