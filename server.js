/**
 * server.js — Punto de entrada principal del sistema de monitoreo solar.
 *
 * Responsabilidades:
 *  - Crea el servidor HTTP con Express (sirve el dashboard estático y la API REST)
 *  - Adjunta el servidor WebSocket al mismo puerto HTTP
 *  - Inicializa la base de datos SQLite (sql.js / WebAssembly) al arrancar
 *
 * Uso:
 *   node server.js          → producción
 *   node --watch server.js  → desarrollo (recarga automática)
 */

require('dotenv').config();

const http    = require('http');
const express = require('express');
const path    = require('path');
const os      = require('os');

const { initDatabase } = require('./src/db/database');
const { createWsServer } = require('./src/ws/wsServer');
const apiRoutes = require('./src/api/apiRoutes');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Obtiene la dirección IP local de la máquina en la red.
 */
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filtrar por IPv4 y que no sea interna (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIp();

// ── Express app ──────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

// ── Servidor HTTP ────────────────────────────────────────────────
const server = http.createServer(app);

// ── Arranque asíncrono ───────────────────────────────────────────
// initDatabase es async porque sql.js carga WebAssembly de forma asíncrona.
(async () => {
  await initDatabase();   // Carga la BD antes de aceptar conexiones
  createWsServer(server); // Adjunta el WS Server al servidor HTTP

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('🌞  Solar Dashboard iniciado');
    console.log(`    Local → http://localhost:${PORT}`);
    console.log(`    Red   → http://${LOCAL_IP}:${PORT}`);
    console.log(`    WS    → ws://${LOCAL_IP}:${PORT}`);
    console.log(`    Token → ${process.env.WS_TOKEN || 'solar_token_secret_2024'}`);
    console.log('');
  });
})();
