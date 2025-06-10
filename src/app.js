require('dotenv').config(); // Asegurate que esto esté al principio

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');

const app = express();

// Lee y transforma los orígenes permitidos desde el .env
const whitelist = process.env.CORS_ORIGINS?.split(',') || [];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir peticiones sin origen (como desde curl o postman)
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
}));

// Seguridad y logs
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(morgan('dev'));

// JSON y rutas
app.use(express.json());
app.use(routes);

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
  });
});

module.exports = app;
