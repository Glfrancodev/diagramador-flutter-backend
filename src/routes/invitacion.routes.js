const express = require('express');
const router = express.Router();
const invitacionController = require('../controllers/invitacion.controller');
const verificarToken = require('../middlewares/auth.middleware');

// Protegido con token
router.post('/', verificarToken, invitacionController.crear);
router.get('/pendientes', verificarToken, invitacionController.listarPendientes);

router.get('/proyecto/:idProyecto', verificarToken, invitacionController.listarPorProyecto);
router.get('/:id', verificarToken, invitacionController.obtener);
router.put('/:id', verificarToken, invitacionController.actualizar);
router.delete('/:id', verificarToken, invitacionController.eliminar);

module.exports = router;
