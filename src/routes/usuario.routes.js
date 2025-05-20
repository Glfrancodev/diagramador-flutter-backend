const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuario.controller');
const verificarToken = require('../middlewares/auth.middleware');

// Público
router.post('/', usuarioController.crear);

// Protegidos
router.get('/', verificarToken, usuarioController.listar);
router.get('/activos', verificarToken, usuarioController.listarActivos); // Nueva ruta
router.get('/perfil', verificarToken, usuarioController.perfil);          // Nueva ruta
router.get('/:id', verificarToken, usuarioController.obtener);
router.put('/:id', verificarToken, usuarioController.actualizar);
router.patch('/:id/estado', verificarToken, usuarioController.cambiarEstado);

module.exports = router;
