/**
 * apiRoutes.js — Rutas de la API REST para el sistema de monitoreo solar.
 *
 * Endpoints expuestos en /api:
 *
 *   GET /api/readings
 *     Retorna las últimas lecturas en formato JSON.
 *     Query param: ?limit=N  (default 100, máx 1000)
 *
 *   GET /api/export/csv
 *     Descarga TODAS las lecturas como archivo CSV.
 *     Nombre del archivo: solar_readings_YYYY-MM-DD.csv
 *
 *   GET /api/status
 *     Estado del servidor: uptime y último dato recibido.
 *
 * Nota: La inserción de datos NO pasa por esta API; el WS Server
 *       llama directamente a insertReading() desde database.js.
 */

const express = require('express');
const router  = express.Router();
const { getRecentReadings, getAllReadings, getReadingsByDays } = require('../db/database');

// ─────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────

/**
 * generateCsv — Convierte un array de objetos a una cadena CSV.
 *
 * Incluye encabezados en la primera fila.
 * Escapa valores que contengan comas envolviendo con comillas dobles.
 *
 * @param {object[]} rows - Filas de la base de datos
 * @returns {string} Contenido CSV completo
 */
function generateCsv(rows) {
  const HEADERS = ['id', 'device_id', 'timestamp', 'sensor_name', 'voltage', 'current', 'power', 'energy'];

  if (rows.length === 0) return HEADERS.join(',') + '\n';

  const lines = [HEADERS.join(',')];

  for (const row of rows) {
    const line = HEADERS.map((col) => {
      const val = String(row[col] ?? '');
      // Wrap en comillas si contiene coma, comilla o salto de línea
      return /[,"\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Rutas
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/readings
 * Retorna las últimas N lecturas de la BD en JSON.
 * Los datos vienen en orden DESC (más reciente primero).
 */
router.get('/readings', (req, res) => {
  try {
    const { days, limit } = req.query;

    // Caso 1: Parámetro 'days' presente -> Retorna CSV filtrado
    if (days) {
      const rows = getReadingsByDays(days);
      const csv  = generateCsv(rows);
      const date = new Date().toISOString().split('T')[0];
      const filename = `solar_readings_${days}dias_${date}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // Caso 2: Parámetro 'limit' presente -> Retorna JSON (usado por el dashboard)
    if (limit) {
      const n        = Math.min(parseInt(limit) || 100, 1000);
      const readings = getRecentReadings(n);
      return res.json({ success: true, count: readings.length, data: readings });
    }

    // Caso 3: Sin parámetros -> Retorna CSV completo (requerimiento usuario)
    const rows     = getAllReadings();
    const csv      = generateCsv(rows);
    const dateStr  = new Date().toISOString().split('T')[0];
    const filename = `solar_readings_completo_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('GET /api/readings error:', err);
    res.status(500).json({ success: false, error: 'Error al obtener lecturas' });
  }
});

/**
 * GET /api/export/csv
 * Genera y descarga un CSV con la totalidad de los registros.
 * El header Content-Disposition indica al browser que descargue el archivo.
 */
router.get('/export/csv', (req, res) => {
  try {
    const rows     = getAllReadings();
    const csv      = generateCsv(rows);
    const dateStr  = new Date().toISOString().split('T')[0];
    const filename = `solar_readings_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('GET /api/export/csv error:', err);
    res.status(500).json({ success: false, error: 'Error al exportar CSV' });
  }
});

/**
 * GET /api/status
 * Devuelve el estado operativo del servidor y el último registro recibido.
 */
router.get('/status', (req, res) => {
  try {
    const last = getRecentReadings(1)[0] || null;
    res.json({
      success:      true,
      status:       'online',
      uptime_s:     Math.round(process.uptime()),
      last_reading: last,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al obtener estado' });
  }
});

module.exports = router;
