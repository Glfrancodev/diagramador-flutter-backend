const express = require('express');
const cors = require('cors');
const routes = require('./routes');
require('dotenv').config(); // Asegúrate que esté antes de usar process.env

const app = express();

/* ---------- CORS ---------- */
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Defínelo en Railway
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

/* ---------- Seguridad y logs (opcional) ---------- */
const helmet = require('helmet');
const morgan = require('morgan');

app.use(helmet()); // Seguridad básica HTTP
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
