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

const { initDatabase } = require('./src/db/database');
const { createWsServer } = require('./src/ws/wsServer');
const apiRoutes = require('./src/api/apiRoutes');

const PORT = process.env.PORT || 3000;

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

  server.listen(PORT, () => {
    console.log('');
    console.log('🌞  Solar Dashboard iniciado');
    console.log(`    HTTP  → http://localhost:${PORT}`);
    console.log(`    WS    → ws://localhost:${PORT}`);
    console.log(`    Token → ${process.env.WS_TOKEN || 'solar_token_secret_2024'}`);
    console.log('');
  });
})();
