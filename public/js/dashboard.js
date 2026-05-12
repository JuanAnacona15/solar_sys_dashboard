/**
 * dashboard.js — Lógica del cliente Dashboard para Solar Monitor.
 *
 * Responsabilidades:
 *  1. Conectar al servidor via WebSocket (sin token = modo visor)
 *  2. Recibir eventos 'reading' y actualizar las tarjetas de métricas en tiempo real
 *  3. Mantener un buffer circular de las últimas 50 lecturas por sensor
 *  4. Inicializar y actualizar 3 gráficos Chart.js (voltaje, corriente, potencia)
 *  5. Cargar el historial inicial desde la API REST al abrir la página
 *  6. Mantener la tabla de historial con las últimas 20 filas
 *  7. Reconexión automática si el WebSocket se desconecta
 *
 * No requiere ningún bundler; se sirve directamente como archivo estático.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────

/** Número máximo de puntos mostrados en cada gráfico */
const MAX_CHART_POINTS = 50;
/** Número máximo de filas en la tabla de historial */
const MAX_TABLE_ROWS = 20;
/** Milisegundos antes de intentar reconectar el WS */
const WS_RECONNECT_MS = 3000;

// ─────────────────────────────────────────────────────────────────
// Buffers de datos para los gráficos
// ─────────────────────────────────────────────────────────────────

/**
 * chartData — Almacena los últimos MAX_CHART_POINTS puntos de cada sensor.
 * Se usa para alimentar los datasets de Chart.js.
 */
const chartData = {
  labels: [],   // timestamps formateados (eje X compartido)
  s1_voltage: [],
  s1_current: [],
  s1_power: [],
  s2_voltage: [],
  s2_current: [],
  s2_power: [],
};

// ─────────────────────────────────────────────────────────────────
// Referencias DOM
// ─────────────────────────────────────────────────────────────────

const DOM = {
  wsStatus: document.getElementById('ws-status'),
  wsDot: document.getElementById('ws-dot'),
  wsLabel: document.getElementById('ws-label'),
  deviceLabel: document.getElementById('device-label'),
  lastTs: document.getElementById('last-ts'),

  s1: {
    voltage: document.getElementById('s1-voltage'),
    current: document.getElementById('s1-current'),
    power: document.getElementById('s1-power'),
    energy: document.getElementById('s1-energy'),
    cards: {
      voltage: document.getElementById('s1-voltage-card'),
      current: document.getElementById('s1-current-card'),
      power: document.getElementById('s1-power-card'),
      energy: document.getElementById('s1-energy-card'),
    },
  },
  s2: {
    voltage: document.getElementById('s2-voltage'),
    current: document.getElementById('s2-current'),
    power: document.getElementById('s2-power'),
    energy: document.getElementById('s2-energy'),
    cards: {
      voltage: document.getElementById('s2-voltage-card'),
      current: document.getElementById('s2-current-card'),
      power: document.getElementById('s2-power-card'),
      energy: document.getElementById('s2-energy-card'),
    },
  },

  tableBody: document.getElementById('table-body'),
  historyCount: document.getElementById('history-count'),
};

// ─────────────────────────────────────────────────────────────────
// Chart.js — Configuración base y creación
// ─────────────────────────────────────────────────────────────────

/** Colores */
const COLOR_S1 = '#10d97a';
const COLOR_S2 = '#3b82f6';

/**
 * makeChartOptions — Genera las opciones comunes para todos los gráficos.
 *
 * @param {string} yLabel - Etiqueta del eje Y
 * @returns {object} Configuración Chart.js
 */
function makeChartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(6,13,26,0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#8ca0c0',
        bodyColor: '#f0f6ff',
        padding: 10,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} ${yLabel}`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#4a5f80',
          font: { size: 10, family: 'Inter' },
          maxRotation: 0,
          maxTicksLimit: 8,
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      y: {
        ticks: {
          color: '#4a5f80',
          font: { size: 10, family: 'Inter' },
          callback: (v) => v.toFixed(1),
        },
        grid: { color: 'rgba(255,255,255,0.06)' },
        title: { display: true, text: yLabel, color: '#4a5f80', font: { size: 10 } },
      },
    },
    animation: { duration: 300 },
  };
}

/**
 * makeDataset — Crea un dataset Chart.js con estilo glassmorphism.
 *
 * @param {string} label  - Nombre del dataset
 * @param {Array}  data   - Referencia al array de datos
 * @param {string} color  - Color de la línea
 * @returns {object}
 */
function makeDataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color + '18',
    borderWidth: 2,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    pointBackgroundColor: color,
    tension: 0.4,
    fill: true,
  };
}

// Crear los tres gráficos
const chartVoltage = new Chart(document.getElementById('chart-voltage'), {
  type: 'line',
  data: {
    labels: chartData.labels,
    datasets: [
      makeDataset('Sensor 1', chartData.s1_voltage, COLOR_S1),
      makeDataset('Sensor 2', chartData.s2_voltage, COLOR_S2),
    ],
  },
  options: makeChartOptions('V'),
});

const chartCurrent = new Chart(document.getElementById('chart-current'), {
  type: 'line',
  data: {
    labels: chartData.labels,
    datasets: [
      makeDataset('Sensor 1', chartData.s1_current, COLOR_S1),
      makeDataset('Sensor 2', chartData.s2_current, COLOR_S2),
    ],
  },
  options: makeChartOptions('A'),
});

const chartPower = new Chart(document.getElementById('chart-power'), {
  type: 'line',
  data: {
    labels: chartData.labels,
    datasets: [
      makeDataset('Sensor 1', chartData.s1_power, COLOR_S1),
      makeDataset('Sensor 2', chartData.s2_power, COLOR_S2),
    ],
  },
  options: makeChartOptions('W'),
});

// ─────────────────────────────────────────────────────────────────
// Funciones de actualización de UI
// ─────────────────────────────────────────────────────────────────

/**
 * formatTimestamp — Formatea un timestamp ISO a una cadena legible corta.
 *
 * @param {string} ts - Timestamp ISO 8601
 * @returns {string} "HH:MM:SS"
 */
function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleTimeString('es-ES');
  } catch {
    return ts;
  }
}

/**
 * setWsStatus — Actualiza el indicador de estado de conexión WebSocket.
 *
 * @param {'connecting'|'online'|'offline'} state
 */
function setWsStatus(state) {
  const dot = DOM.wsDot;
  const label = DOM.wsLabel;
  dot.className = 'status-badge__dot';

  if (state === 'online') {
    dot.classList.add('status-badge__dot--online');
    label.textContent = 'Conectado';
  } else if (state === 'offline') {
    dot.classList.add('status-badge__dot--offline');
    label.textContent = 'Desconectado';
  } else {
    label.textContent = 'Conectando…';
  }
}

/**
 * flashCard — Aplica la animación de actualización a una tarjeta de métrica.
 *
 * @param {HTMLElement} card - Elemento de la tarjeta
 */
function flashCard(card) {
  card.classList.remove('updated');
  void card.offsetWidth; // reflow para reiniciar la animación
  card.classList.add('updated');
}

/**
 * updateMetricCards — Actualiza los valores de las tarjetas para ambos sensores.
 *
 * @param {object} sensor1 - { voltage, current, power, energy }
 * @param {object} sensor2 - { voltage, current, power, energy }
 */
function updateMetricCards(sensor1, sensor2) {
  const fields = ['voltage', 'current', 'power', 'energy'];
  const sensors = [
    { data: sensor1, dom: DOM.s1 },
    { data: sensor2, dom: DOM.s2 },
  ];

  for (const { data, dom } of sensors) {
    for (const field of fields) {
      const val = data[field];
      if (val !== undefined) {
        dom[field].textContent = val;
        flashCard(dom.cards[field]);
      }
    }
  }
}

/**
 * pushChartPoint — Agrega un nuevo punto a los buffers del gráfico.
 * Elimina el punto más antiguo si se supera MAX_CHART_POINTS.
 *
 * @param {string} label    - Etiqueta del eje X (tiempo formateado)
 * @param {object} sensor1  - Datos del sensor 1
 * @param {object} sensor2  - Datos del sensor 2
 */
function pushChartPoint(label, sensor1, sensor2) {
  chartData.labels.push(label);
  chartData.s1_voltage.push(sensor1.voltage);
  chartData.s1_current.push(sensor1.current);
  chartData.s1_power.push(sensor1.power);
  chartData.s2_voltage.push(sensor2.voltage);
  chartData.s2_current.push(sensor2.current);
  chartData.s2_power.push(sensor2.power);

  // Mantener el buffer dentro del límite
  if (chartData.labels.length > MAX_CHART_POINTS) {
    chartData.labels.shift();
    chartData.s1_voltage.shift();
    chartData.s1_current.shift();
    chartData.s1_power.shift();
    chartData.s2_voltage.shift();
    chartData.s2_current.shift();
    chartData.s2_power.shift();
  }

  chartVoltage.update();
  chartCurrent.update();
  chartPower.update();
}

/**
 * addTableRow — Inserta una nueva fila al inicio de la tabla de historial.
 * Elimina las filas más antiguas si se supera MAX_TABLE_ROWS.
 *
 * @param {object} params - { timestamp, device_id, sensor_name, voltage, current, power, energy }
 */
function addTableRow({ timestamp, device_id, sensor_name, voltage, current, power, energy }) {
  // Eliminar placeholder vacío si existe
  const empty = DOM.tableBody.querySelector('.table-empty');
  if (empty) empty.remove();

  const tr = document.createElement('tr');
  tr.className = 'row-new';

  const sensorNum = sensor_name === 'sensor1' ? '1' : '2';
  tr.innerHTML = `
    <td>${new Date(timestamp).toLocaleString('es-ES')}</td>
    <td>${device_id}</td>
    <td><span class="sensor-tag sensor-tag--${sensorNum}">${sensor_name.toUpperCase()}</span></td>
    <td>${Number(voltage).toFixed(2)}</td>
    <td>${Number(current).toFixed(2)}</td>
    <td>${Number(power).toFixed(2)}</td>
    <td>${Number(energy).toFixed(2)}</td>
  `;

  DOM.tableBody.prepend(tr);

  // Limitar filas visibles
  const rows = DOM.tableBody.querySelectorAll('tr:not(.table-empty)');
  if (rows.length > MAX_TABLE_ROWS) {
    rows[rows.length - 1].remove();
  }

  DOM.historyCount.textContent = `${DOM.tableBody.querySelectorAll('tr').length} registros`;
}

// ─────────────────────────────────────────────────────────────────
// Carga inicial de historial desde la API
// ─────────────────────────────────────────────────────────────────

/**
 * loadInitialHistory — Carga las últimas lecturas desde la API REST al iniciar.
 * Alimenta los gráficos y la tabla con datos históricos antes del primer WS mensaje.
 */
async function loadInitialHistory() {
  try {
    const res = await fetch(`/api/readings?limit=${MAX_CHART_POINTS * 2}`);
    const json = await res.json();

    if (!json.success || !json.data.length) return;

    // Los datos vienen ordenados DESC (más reciente primero).
    // Para los gráficos necesitamos orden ASC, así que invertimos.
    const rows = [...json.data].reverse();

    // Agrupar por timestamp para reconstruir pares sensor1/sensor2
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.timestamp)) grouped.set(row.timestamp, {});
      grouped.get(row.timestamp)[row.sensor_name] = row;
    }

    // Alimentar gráficos (solo pares completos)
    for (const [ts, sensors] of grouped) {
      if (sensors.sensor1 && sensors.sensor2) {
        pushChartPoint(formatTimestamp(ts), sensors.sensor1, sensors.sensor2);
      }
    }

    // Alimentar tabla (las últimas MAX_TABLE_ROWS filas, en orden DESC)
    const tableRows = json.data.slice(0, MAX_TABLE_ROWS);
    // Insertar en orden (más antiguo primero para que el prepend quede correcto)
    for (const row of [...tableRows].reverse()) {
      addTableRow(row);
    }

    console.log(`[Dashboard] Historial cargado: ${rows.length} lecturas`);
  } catch (err) {
    console.warn('[Dashboard] No se pudo cargar el historial:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// WebSocket — Conexión y manejo de eventos
// ─────────────────────────────────────────────────────────────────

let ws;
let reconnectTimer;

/**
 * connectWebSocket — Abre la conexión WebSocket al servidor.
 * Implementa reconexión automática ante desconexiones inesperadas.
 */
function connectWebSocket() {
  clearTimeout(reconnectTimer);
  setWsStatus('connecting');

  const wsUrl = `ws://${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setWsStatus('online');
    console.log('[WS] Conectado al servidor');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'reading') {
      onReading(msg);
    }
    // Ignorar type: 'connected', 'ack', etc.
  });

  ws.addEventListener('close', () => {
    setWsStatus('offline');
    console.warn('[WS] Conexión cerrada. Reconectando en', WS_RECONNECT_MS, 'ms…');
    reconnectTimer = setTimeout(connectWebSocket, WS_RECONNECT_MS);
  });

  ws.addEventListener('error', (err) => {
    console.error('[WS] Error:', err);
  });
}

/**
 * onReading — Procesa un evento 'reading' recibido via WebSocket.
 * Actualiza las tarjetas, los gráficos y la tabla.
 *
 * @param {object} msg - Evento completo: { device_id, timestamp, sensor1, sensor2 }
 */
function onReading(msg) {
  const { device_id, timestamp, sensor1, sensor2 } = msg;

  // Actualizar tarjetas de métricas
  updateMetricCards(sensor1, sensor2);

  // Actualizar timestamp e ID de dispositivo en el header
  DOM.lastTs.textContent = new Date(timestamp).toLocaleString('es-ES');
  DOM.deviceLabel.textContent = device_id;

  // Agregar punto al gráfico
  pushChartPoint(formatTimestamp(timestamp), sensor1, sensor2);

  // Agregar filas a la tabla (sensor2 primero para que sensor1 quede arriba)
  addTableRow({ timestamp, device_id, sensor_name: 'sensor2', ...sensor2 });
  addTableRow({ timestamp, device_id, sensor_name: 'sensor1', ...sensor1 });
}

// ─────────────────────────────────────────────────────────────────
// Inicio
// ─────────────────────────────────────────────────────────────────

(async () => {
  await loadInitialHistory();
  connectWebSocket();
})();
