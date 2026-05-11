/**
 * wsServer.js — Servidor WebSocket para el sistema de monitoreo solar.
 *
 * Gestiona dos tipos de clientes:
 *
 *  1. DISPOSITIVO ESP32
 *     Conecta con token en la URL: ws://host:3000?token=MI_TOKEN
 *     → Se autentica, envía mensajes JSON con datos de sensores
 *     → El servidor valida, agrega server_timestamp, guarda en DB
 *       y hace broadcast a todos los dashboards conectados.
 *
 *  2. DASHBOARD (browser)
 *     Conecta sin token: ws://host:3000
 *     → Solo recibe mensajes (modo lectura/suscripción)
 *     → Recibe un broadcast cada vez que llega un dato válido del ESP32
 *
 * Formato esperado del ESP32:
 * {
 *   "device_id": "esp32_01",
 *   "timestamp": "2026-03-25T14:32:45Z",   ← opcional (se usa server_ts si falta)
 *   "sensor1": { "voltage": 12.45, "current": 3.52, "power": 43.8, "energy": 1245.6 },
 *   "sensor2": { "voltage": 18.10, "current": 2.90, "power": 52.4, "energy": 980.3  }
 * }
 */

const WebSocket = require('ws');
const url = require('url');
const { insertReading } = require('../db/database');

/** Clientes ESP32 autenticados */
const deviceClients = new Set();
/** Clientes dashboard (browsers) */
const dashboardClients = new Set();

/** Campos obligatorios dentro de cada objeto sensor */
const SENSOR_FIELDS = ['voltage', 'current', 'power', 'energy'];

// ─────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────

/**
 * validatePayload — Verifica que el JSON del ESP32 tenga el schema correcto.
 *
 * @param {object} payload - Objeto JavaScript ya parseado
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePayload(payload) {
  if (!payload.device_id) return { valid: false, error: 'Falta device_id' };

  for (const sensor of ['sensor1', 'sensor2']) {
    if (!payload[sensor]) return { valid: false, error: `Falta ${sensor}` };
    for (const field of SENSOR_FIELDS) {
      if (payload[sensor][field] === undefined) {
        return { valid: false, error: `${sensor}.${field} es requerido` };
      }
    }
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────
// Broadcast
// ─────────────────────────────────────────────────────────────────

/**
 * broadcastToDashboards — Envía un objeto JSON a todos los dashboards abiertos.
 *
 * @param {object} data - Datos a transmitir (se serializan a JSON)
 */
function broadcastToDashboards(data) {
  const msg = JSON.stringify(data);
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Creación del servidor
// ─────────────────────────────────────────────────────────────────

/**
 * createWsServer — Crea e inicializa el WS Server adjunto al servidor HTTP.
 *
 * Se adhiere al mismo puerto que Express; no necesita puerto propio.
 *
 * @param {import('http').Server} httpServer - Servidor HTTP de Express
 * @returns {WebSocket.Server}
 */
function createWsServer(httpServer) {
  const TOKEN = process.env.WS_TOKEN || 'solar_token_secret_2024';
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws, request) => {
    const clientIp = request.socket.remoteAddress;
    const authHeader = request.headers['authorization'];


    ws.isAuthenticated = false;
    ws.isDashboard = true;

    console.log(`🔌 Nueva conexión desde [${clientIp}]`);
    if (authHeader) {
      console.log(`🔑 Header Authorization detectado: "${authHeader.substring(0, 15)}..."`);
    } else {
      console.log(`ℹ️  Sin header Authorization en la conexión inicial.`);
    }

    // ── Intentar auth por header ─────────────────────
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];

      if (token === TOKEN) {
        ws.isAuthenticated = true;
        ws.isDashboard = false;
        deviceClients.add(ws);

        console.log(`✅ ESP32 autenticado por header [${clientIp}]`);

        ws.send(JSON.stringify({
          type: 'auth',
          status: 'authenticated'
        }));
      } else {
        console.warn(`❌ Token en header inválido desde [${clientIp}]`);
      }
    }

    // ── Si no se autenticó, asumir dashboard temporalmente ──
    if (!ws.isAuthenticated) {
      dashboardClients.add(ws);

      console.log(`🖥️   Dashboard conectado [${clientIp}] | dashboards: ${dashboardClients.size}`);

      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Conectado al servidor solar'
      }));
    }

    // ─────────────────────────────────────────────────
    // MENSAJES
    // ─────────────────────────────────────────────────

    ws.on('message', (raw) => {
      let payload;

      try {
        const cleaned = raw
          .toString()
          .replace(/\bnan\b/gi, '0');

        payload = JSON.parse(cleaned);
        // Log para ver qué está mandando exactamente si no está autenticado
        if (!ws.isAuthenticated) {
          console.log(`📩 Mensaje recibido de cliente no autenticado [${clientIp}]:`, JSON.stringify(payload));
        }
      } catch {
        console.error(`⚠️ Error al parsear JSON desde [${clientIp}]:`, raw.toString());
        ws.send(JSON.stringify({ type: 'error', message: 'JSON inválido' }));
        return;
      }

      // ── AUTH POR MENSAJE (ESP32 actual) ─────────────
      if (payload.type === 'auth' && payload.token === TOKEN) {
        if (!ws.isAuthenticated) {
          ws.isAuthenticated = true;
          ws.isDashboard = false;

          dashboardClients.delete(ws);
          deviceClients.add(ws);

          console.log(`✅ ESP32 autenticado por mensaje JSON [${clientIp}]`);

          ws.send(JSON.stringify({
            type: 'auth',
            status: 'authenticated'
          }));
        }
        return;
      } else if (payload.type === 'auth') {
        console.warn(`❌ Intento de auth fallido (token incorrecto) desde [${clientIp}]`);
      }

      // ── BLOQUEAR DATOS SI NO ESTÁ AUTENTICADO ───────
      if (!ws.isAuthenticated) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'No autenticado para enviar datos'
        }));
        return;
      }

      // ── VALIDAR LECTURAS ────────────────────────────
      const { valid, error } = validatePayload(payload);
      if (!valid) {
        ws.send(JSON.stringify({ type: 'error', message: error }));
        return;
      }

      // ── PROCESAR DATOS (Timestamps, DB, Broadcast) ──
      const serverTs = new Date().toISOString();
      const deviceTs = payload.timestamp || serverTs;

      try {
        for (const sensorKey of ['sensor1', 'sensor2']) {
          insertReading({
            device_id: payload.device_id,
            timestamp: deviceTs,
            sensor_name: sensorKey,
            voltage: payload[sensorKey].voltage,
            current: payload[sensorKey].current,
            power: payload[sensorKey].power,
            energy: payload[sensorKey].energy,
          });
        }
      } catch (dbErr) {
        console.error('❌  Error DB:', dbErr.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Error al guardar datos' }));
        return;
      }

      const event = {
        type: 'reading',
        device_id: payload.device_id,
        timestamp: deviceTs,
        server_timestamp: serverTs,
        sensor1: payload.sensor1,
        sensor2: payload.sensor2,
      };
      broadcastToDashboards(event);

      console.log(`📊  [${payload.device_id}] datos guardados | dashboards: ${dashboardClients.size}`);
      ws.send(JSON.stringify({ type: 'ack', server_timestamp: serverTs }));
    });

    ws.on('close', () => {
      if (ws.isAuthenticated) {
        deviceClients.delete(ws);
        console.log(`🔌  ESP32 desconectado | dispositivos: ${deviceClients.size}`);
      } else {
        dashboardClients.delete(ws);
        console.log(`🖥️   Dashboard desconectado | dashboards: ${dashboardClients.size}`);
      }
    });

    ws.on('error', (err) => console.error(`⚠️   WS error: ${err.message}`));
  });

  console.log('✅  WebSocket Server adjunto al servidor HTTP');
  return wss;
}

module.exports = { createWsServer };
