'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Minimal appointment store. Persists to a JSON file so the demo survives
 * restarts; pass `file: null` for an in-memory store (used by tests).
 * Swap this module for a database (Postgres, Supabase, Airtable…) in production.
 */
class AppointmentStore {
  constructor({ file = path.join(__dirname, '..', 'data', 'appointments.json') } = {}) {
    this.file = file;
    this.appointments = [];
    if (file && fs.existsSync(file)) {
      this.appointments = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }

  all() {
    return [...this.appointments].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
    );
  }

  active() {
    return this.all().filter((a) => a.status === 'confirmed');
  }

  onDate(date) {
    return this.active().filter((a) => a.date === date);
  }

  get(id) {
    return this.appointments.find((a) => a.id === id) || null;
  }

  byPhone(phone) {
    const norm = normalisePhone(phone);
    return this.active().filter((a) => normalisePhone(a.customer.phone) === norm);
  }

  add(appointment) {
    this.appointments.push(appointment);
    this.save();
    return appointment;
  }

  update(id, changes) {
    const a = this.get(id);
    if (!a) return null;
    Object.assign(a, changes);
    this.save();
    return a;
  }

  nextId() {
    const n = this.appointments.length + 1;
    return `CITA-${String(n).padStart(4, '0')}`;
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.appointments, null, 2));
  }
}

function normalisePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.startsWith('34') && digits.length === 11 ? digits.slice(2) : digits;
}

module.exports = { AppointmentStore, normalisePhone };
