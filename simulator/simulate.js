/**
 * simulate.js — Simulador independiente de dispositivo ESP32.
 *
 * Este script imita el comportamiento de un ESP32 real conectado al servidor
 * de monitoreo solar. Se ejecuta de forma INDEPENDIENTE del proyecto principal;
 * tiene su propio package.json y no comparte dependencias.
 *
 * Funcionalidades:
 *  - Conecta al servidor via WebSocket usando el token de autenticación
 *  - Genera datos fotovoltaicos realistas con variaciones graduales
 *  - Envía un paquete de datos cada 1 segundo
 *  - Muestra en consola el estado de cada envío
 *  - Reconecta automáticamente si la conexión se pierde
 *
 * Configuración (variables de entorno, archivo .env en esta carpeta):
 *   WS_URL   → URL del servidor WebSocket (default: ws://localhost:3000)
 *   WS_TOKEN → Token de autenticación    (default: solar_token_secret_2024)
 *   DEVICE_ID→ ID del dispositivo        (default: esp32_01)
 *
 * Uso:
 *   cd simulator
 *   npm install
 *   node simulate.js
 *
 * O con variables personalizadas:
 *   WS_URL=ws://192.168.1.100:3000 WS_TOKEN=mi_token node simulate.js
 */

require('dotenv').config();
const WebSocket = require('ws');

// ─────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────

const WS_URL      = process.env.WS_URL    || 'ws://localhost:3000';
const WS_TOKEN    = process.env.WS_TOKEN  || 'solar_token_secret_2024';
const DEVICE_ID   = process.env.DEVICE_ID || 'esp32_01';
const INTERVAL_MS = 1000;       // Enviar datos cada 1 segundo
const RECONNECT_MS = 5000;      // Tiempo antes de reconectar tras desconexión

// URL completa con token de autenticación
const WS_FULL_URL = `${WS_URL}?token=${WS_TOKEN}`;

// ─────────────────────────────────────────────────────────────────
// Generador de datos fotovoltaicos
// ─────────────────────────────────────────────────────────────────

/**
 * Estado interno del simulador.
 * Los valores varían gradualmente para simular cambios reales de irradiación solar.
 */
const state = {
  s1_voltage: 12.0,    // V  — batería / panel
  s1_current: 3.0,     // A
  s1_energy:  1200.0,  // Wh acumulados
  s2_voltage: 17.5,    // V  — salida del regulador
  s2_current: 2.5,     // A
  s2_energy:  950.0,   // Wh acumulados
};

/**
 * clamp — Limita un valor entre un mínimo y un máximo.
 *
 * @param {number} val - Valor a limitar
 * @param {number} min - Mínimo
 * @param {number} max - Máximo
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * nudge — Aplica una pequeña variación aleatoria a un valor.
 * Simula cambios graduales (±delta por lectura).
 *
 * @param {number} val   - Valor actual
 * @param {number} delta - Máxima variación
 * @param {number} min   - Límite inferior
 * @param {number} max   - Límite superior
 * @returns {number} Nuevo valor
 */
function nudge(val, delta, min, max) {
  const change = (Math.random() * 2 - 1) * delta;
  return clamp(parseFloat((val + change).toFixed(3)), min, max);
}

/**
 * round2 — Redondea a 2 decimales.
 *
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * generatePayload — Genera el payload JSON que enviaría un ESP32 real.
 * Actualiza el estado interno del simulador.
 *
 * @returns {object} Payload listo para enviar via WebSocket
 */
function generatePayload() {
  // Variaciones graduales
  state.s1_voltage = nudge(state.s1_voltage, 0.15, 10.0, 15.0);
  state.s1_current = nudge(state.s1_current, 0.12, 1.0, 6.0);
  state.s2_voltage = nudge(state.s2_voltage, 0.20, 14.0, 22.0);
  state.s2_current = nudge(state.s2_current, 0.10, 0.5, 5.0);

  // Potencia = Voltaje × Corriente
  const s1_power = round2(state.s1_voltage * state.s1_current);
  const s2_power = round2(state.s2_voltage * state.s2_current);

  // Energía acumulada (incrementa con cada lectura)
  state.s1_energy = round2(state.s1_energy + s1_power * (INTERVAL_MS / 3_600_000));
  state.s2_energy = round2(state.s2_energy + s2_power * (INTERVAL_MS / 3_600_000));

  return {
    device_id: DEVICE_ID,
    timestamp: new Date().toISOString(),
    sensor1: {
      voltage: round2(state.s1_voltage),
      current: round2(state.s1_current),
      power:   s1_power,
      energy:  state.s1_energy,
    },
    sensor2: {
      voltage: round2(state.s2_voltage),
      current: round2(state.s2_current),
      power:   s2_power,
      energy:  state.s2_energy,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// WebSocket — Conexión y envío periódico
// ─────────────────────────────────────────────────────────────────

let ws;
let sendInterval;
let isConnected = false;

/**
 * startSending — Inicia el intervalo de envío periódico de datos.
 * Cancela cualquier intervalo previo antes de iniciar.
 */
function startSending() {
  clearInterval(sendInterval);
  sendInterval = setInterval(() => {
    if (!isConnected || ws.readyState !== WebSocket.OPEN) return;

    const payload = generatePayload();

    try {
      ws.send(JSON.stringify(payload));
      process.stdout.write(
        `\r📡 [${new Date().toLocaleTimeString('es-ES')}] ` +
        `S1: ${payload.sensor1.voltage}V / ${payload.sensor1.current}A / ${payload.sensor1.power}W | ` +
        `S2: ${payload.sensor2.voltage}V / ${payload.sensor2.current}A / ${payload.sensor2.power}W  `
      );
    } catch (err) {
      console.error('\n❌ Error al enviar:', err.message);
    }
  }, INTERVAL_MS);
}

/**
 * connect — Abre la conexión WebSocket al servidor.
 * Configura todos los event listeners y la reconexión automática.
 */
function connect() {
  console.log(`\n🔌 Conectando a ${WS_URL} como ${DEVICE_ID}…`);
  ws = new WebSocket(WS_FULL_URL);

  ws.on('open', () => {
    console.log('✅ Conexión establecida. Enviando datos cada 1 segundo…\n');
    isConnected = true;
    startSending();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'error') {
        console.error('\n❌ Error del servidor:', msg.message);
      }
      // type: 'auth' y 'ack' se ignoran (solo confirman operación normal)
    } catch { /* ignorar mensajes no JSON */ }
  });

  ws.on('close', (code, reason) => {
    isConnected = false;
    clearInterval(sendInterval);
    console.log(`\n🔴 Conexión cerrada (código ${code}). Reconectando en ${RECONNECT_MS / 1000}s…`);
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (err) => {
    console.error(`\n⚠️  Error WS: ${err.message}`);
  });
}

// ─────────────────────────────────────────────────────────────────
// Inicio
// ─────────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════');
console.log('   ESP32 SIMULATOR — Sistema Fotovoltaico Solar       ');
console.log('══════════════════════════════════════════════════════');
console.log(`   Servidor  : ${WS_URL}`);
console.log(`   Dispositivo: ${DEVICE_ID}`);
console.log(`   Intervalo  : ${INTERVAL_MS}ms`);
console.log('══════════════════════════════════════════════════════\n');

connect();

// Manejar cierre limpio con Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Simulador detenido por el usuario.');
  clearInterval(sendInterval);
  if (ws) ws.close();
  process.exit(0);
});
