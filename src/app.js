const express = require('express');
const cors = require('cors');
const routes = require('./routes');
require('dotenv').config(); // Asegúrate que esté antes de usar process.env

const app = express();

const whitelist = [
  'http://localhost:5173',
  'https://tuapp.com', // ← producción
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
}));


/* ---------- Seguridad y logs (opcional) ---------- */
const helmet = require('helmet');
const morgan = require('morgan');

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

app.use(morgan('dev')); // Logs de peticiones HTTP

/* ---------- JSON y Rutas ---------- */
app.use(express.json());
app.use(routes);

/* ---------- Manejo de errores global ---------- */
app.use((err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
  });
});

module.exports = app;
