const express = require('express');
const router = express.Router();

const usuarioRoutes = require('./usuario.routes');
const authRoutes = require('./auth.routes');
const proyectoRoutes = require('./proyecto.routes');
const invitacionRoutes = require('./invitacion.routes');

router.use('/api/usuarios', usuarioRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/proyectos', proyectoRoutes);
router.use('/api/invitaciones', invitacionRoutes);

module.exports = router;
