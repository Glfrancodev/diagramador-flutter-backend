const express = require('express');
const router = express.Router();
const proyectoController = require('../controllers/proyecto.controller');
const verificarToken = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Carpeta temporal

// Protegidos
router.post('/', verificarToken, proyectoController.crear);
router.get('/', verificarToken, proyectoController.listar);
router.get('/permisos', verificarToken, proyectoController.listarPermitidos);
router.get('/invitados', verificarToken, proyectoController.listarInvitados);
router.post('/importar-boceto', upload.single('imagen'), proyectoController.importarBoceto);
router.get('/:id/exportar-flutter', verificarToken, proyectoController.exportarProyectoFlutter); // ✅ Export dinámico

router.get('/mis-proyectos', verificarToken, proyectoController.listarPorUsuario);
router.get('/:id', verificarToken, proyectoController.obtener);
router.put('/:id', verificarToken, proyectoController.actualizar);
router.delete('/:id', verificarToken, proyectoController.eliminar);

module.exports = router;
