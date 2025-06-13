const express = require('express');
const router = express.Router();

const usuarioRoutes    = require('./usuario.routes');
const authRoutes       = require('./auth.routes');
const proyectoRoutes   = require('./proyecto.routes');
const invitacionRoutes = require('./invitacion.routes');
const archivoRoutes    = require('./archivo.routes');

// ✅ Ruta de verificación (para PWA / offline detection)
router.get('/ping', (_, res) => res.send('pong'));

router.use('/api/usuarios', usuarioRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/proyectos', proyectoRoutes);
router.use('/api/invitaciones', invitacionRoutes);
router.use('/api/archivos', archivoRoutes);

module.exports = router;
