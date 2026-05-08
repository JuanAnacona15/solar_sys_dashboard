/**
 * database.js — Módulo de gestión de la base de datos SQLite con sql.js.
 *
 * Usa sql.js (WebAssembly puro) en lugar de better-sqlite3 para evitar
 * compilación nativa, siendo compatible con cualquier versión de Node.js.
 *
 * La base de datos se persiste en disco en data/solar.db.
 * Se guarda automáticamente tras cada escritura usando fs.writeFileSync.
 *
 * Schema de la tabla `readings`:
 *   id          INTEGER  Identificador único autoincremental
 *   device_id   TEXT     ID del dispositivo ESP32 (ej: "esp32_01")
 *   timestamp   TEXT     Timestamp ISO 8601 del dispositivo o servidor
 *   sensor_name TEXT     "sensor1" | "sensor2"
 *   voltage     REAL     Voltaje en Volts (V)
 *   current     REAL     Corriente en Amperes (A)
 *   power       REAL     Potencia en Watts (W)
 *   energy      REAL     Energía acumulada en Wh
 *
 * Nota: Cada mensaje ESP32 genera DOS filas (una por sensor).
 */

const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

// Rutas de datos
const DB_DIR  = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'solar.db');

/** Instancia de la BD (disponible tras initDatabase()) */
let db;

// ─────────────────────────────────────────────────────────────────
// Persistencia en disco
// ─────────────────────────────────────────────────────────────────

/**
 * saveToDisk — Escribe el estado actual de la BD en el archivo .db.
 * sql.js trabaja en memoria; esta función persiste los datos en disco.
 */
function saveToDisk() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─────────────────────────────────────────────────────────────────
// Inicialización
// ─────────────────────────────────────────────────────────────────

/**
 * initDatabase — Inicializa sql.js y carga (o crea) la base de datos.
 *
 * Es asíncrona porque sql.js carga el WebAssembly de forma async.
 * Debe ejecutarse con `await` en server.js.
 *
 * @returns {Promise<void>}
 */
async function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Si ya existe un archivo .db, cargarlo; si no, crear uno nuevo
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log(`✅  Base de datos cargada: ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log(`✅  Base de datos nueva creada: ${DB_PATH}`);
  }

  // Crear tabla e índices si no existen
  db.run(`
    CREATE TABLE IF NOT EXISTS readings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      sensor_name TEXT    NOT NULL,
      voltage     REAL,
      current     REAL,
      power       REAL,
      energy      REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ts     ON readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_device ON readings(device_id);
  `);

  // Guardar estructura inicial en disco
  saveToDisk();
}

// ─────────────────────────────────────────────────────────────────
// Escritura
// ─────────────────────────────────────────────────────────────────

/**
 * insertReading — Inserta una fila en `readings` y persiste en disco.
 *
 * @param {object} data
 * @param {string} data.device_id
 * @param {string} data.timestamp
 * @param {string} data.sensor_name - "sensor1" | "sensor2"
 * @param {number} data.voltage
 * @param {number} data.current
 * @param {number} data.power
 * @param {number} data.energy
 */
function insertReading({ device_id, timestamp, sensor_name, voltage, current, power, energy }) {
  db.run(
    `INSERT INTO readings (device_id, timestamp, sensor_name, voltage, current, power, energy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [device_id, timestamp, sensor_name, voltage, current, power, energy]
  );
  saveToDisk();
}

// ─────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────

/**
 * rowsToObjects — Convierte el resultado de sql.js (formato columnar) a
 * un array de objetos planos que imitan el formato de mejor-sqlite3.
 *
 * @param {object[]} results - Resultado de db.exec()
 * @returns {object[]}
 */
function rowsToObjects(results) {
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

/**
 * getRecentReadings — Retorna las últimas N lecturas ordenadas por id DESC.
 *
 * @param {number} [limit=100]
 * @returns {object[]}
 */
function getRecentReadings(limit = 100) {
  const results = db.exec(
    `SELECT * FROM readings ORDER BY id DESC LIMIT ${parseInt(limit)}`
  );
  return rowsToObjects(results);
}

/**
 * getAllReadings — Retorna todos los registros ordenados por id ASC.
 * Usado para la exportación CSV completa.
 *
 * @returns {object[]}
 */
function getAllReadings() {
  const results = db.exec('SELECT * FROM readings ORDER BY id ASC');
  return rowsToObjects(results);
}

/**
 * getReadingsByDays — Retorna los registros de los últimos X días.
 *
 * @param {number} days
 * @returns {object[]}
 */
function getReadingsByDays(days) {
  const results = db.exec(
    `SELECT * FROM readings 
     WHERE timestamp >= datetime('now', '-${parseInt(days)} days') 
     ORDER BY id ASC`
  );
  return rowsToObjects(results);
}

module.exports = { initDatabase, insertReading, getRecentReadings, getAllReadings, getReadingsByDays };
