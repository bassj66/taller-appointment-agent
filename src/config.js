'use strict';

// Workshop configuration. Edit this file to adapt the agent to a real workshop.
module.exports = {
  workshop: {
    name: 'Taller Demo Motor',
    address: 'Carrer de l\'Exemple 12, El Prat de Llobregat',
    phone: '+34 900 000 000',
    timezone: 'Europe/Madrid',
  },

  // Opening hours per weekday (0 = Sunday … 6 = Saturday). Empty = closed.
  // Each range is [open, close] in HH:MM.
  openingHours: {
    0: [],
    1: [['09:00', '14:00'], ['15:30', '19:00']],
    2: [['09:00', '14:00'], ['15:30', '19:00']],
    3: [['09:00', '14:00'], ['15:30', '19:00']],
    4: [['09:00', '14:00'], ['15:30', '19:00']],
    5: [['09:00', '14:00'], ['15:30', '19:00']],
    6: [['09:00', '13:00']],
  },

  slotMinutes: 30,        // granularity of the agenda
  bays: 2,                // how many cars can be worked on at the same time
  maxDaysAhead: 30,       // how far ahead customers can book

  // Price ranges are indicative (EUR, VAT included) — the final quote depends on the vehicle.
  services: [
    { id: 'cambio-aceite', name: 'Cambio de aceite y filtro', durationMin: 30, priceFrom: 60, priceTo: 110, keywords: ['aceite', 'filtro', 'oil'] },
    { id: 'revision', name: 'Revisión general', durationMin: 60, priceFrom: 90, priceTo: 180, keywords: ['revision', 'revisión', 'mantenimiento', 'general'] },
    { id: 'frenos', name: 'Pastillas de freno (eje)', durationMin: 60, priceFrom: 80, priceTo: 160, keywords: ['freno', 'frenos', 'pastillas'] },
    { id: 'neumaticos', name: 'Cambio de neumáticos (x2) y equilibrado', durationMin: 45, priceFrom: 25, priceTo: 40, keywords: ['neumatico', 'neumático', 'neumaticos', 'neumáticos', 'ruedas', 'rueda'], note: 'Precio de montaje; neumáticos aparte.' },
    { id: 'diagnosis', name: 'Diagnosis electrónica', durationMin: 30, priceFrom: 40, priceTo: 60, keywords: ['diagnosis', 'diagnostico', 'diagnóstico', 'testigo', 'luz', 'averia', 'avería'] },
    { id: 'pre-itv', name: 'Pre-ITV', durationMin: 45, priceFrom: 35, priceTo: 50, keywords: ['itv', 'pre-itv', 'preitv'] },
    { id: 'aire-acondicionado', name: 'Carga de aire acondicionado', durationMin: 60, priceFrom: 60, priceTo: 90, keywords: ['aire', 'acondicionado', 'climatizador', 'a/c'] },
  ],
};
