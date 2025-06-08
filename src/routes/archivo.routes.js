const express = require('express');
const router = express.Router();
const archivoController = require('../controllers/archivo.controller');
const verificarToken = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer(); // sin destino, usa buffer en memoria

router.post('/', verificarToken, upload.single('archivo'), archivoController.subir);
router.get('/:idProyecto', verificarToken, archivoController.listar);
router.get('/detalle/:id', verificarToken, archivoController.obtener);
router.get('/:id/descargar', verificarToken, archivoController.descargar);
router.delete('/:id', verificarToken, archivoController.eliminar);

module.exports = router;
