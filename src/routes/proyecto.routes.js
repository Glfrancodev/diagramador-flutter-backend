const express = require('express');
const router = express.Router();
const proyectoController = require('../controllers/proyecto.controller');
const verificarToken = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Carpeta temporal

// ──────────────── Rutas protegidas ────────────────
router.post('/', verificarToken, proyectoController.crear);
router.get('/', verificarToken, proyectoController.listar);
router.get('/permisos', verificarToken, proyectoController.listarPermitidos);
router.get('/invitados', verificarToken, proyectoController.listarInvitados);
router.get('/:id/exportar-flutter', verificarToken, proyectoController.exportarProyectoFlutter);

router.get('/mis-proyectos', verificarToken, proyectoController.listarPorUsuario);
router.get('/:id', verificarToken, proyectoController.obtener);
router.put('/:id', verificarToken, proyectoController.actualizar);
router.delete('/:id', verificarToken, proyectoController.eliminar);

// ──────────────── Importaciones y generación IA ────────────────
router.post('/importar-boceto', verificarToken, upload.single('imagen'), proyectoController.importarBoceto);
router.post('/generar-desde-prompt', verificarToken, proyectoController.generarDesdePrompt);

// ──────────────── Audio IA ────────────────
router.post('/audio-a-texto', verificarToken, upload.single('audio'), proyectoController.audioATexto);
router.post('/audio-a-datos', verificarToken, upload.single('audio'), proyectoController.audioADatos); // ✅ nueva

// ──────────────── Bot asistente del editor (chatbot) ────────────────
router.post('/:id/duda-bot', verificarToken, proyectoController.responderDudaDelBot);

module.exports = router;
