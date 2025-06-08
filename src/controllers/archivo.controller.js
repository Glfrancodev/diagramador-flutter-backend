const archivoService = require('../services/archivo.service');
const minioClient = require('../config/minio.client');
const { v4: uuidv4 } = require('uuid');

class ArchivoController {
  async subir(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se recibió archivo' });
      }

      const bucket = process.env.MINIO_BUCKET;
      const nombreUnico = `${uuidv4()}_${req.file.originalname}`;
      const mimeType = req.file.mimetype;

      // Subir a MinIO
      await minioClient.putObject(bucket, nombreUnico, req.file.buffer, {
        'Content-Type': mimeType,
      });

      // URL pública
      const url = `${process.env.MINIO_PUBLIC_URL}/${nombreUnico}`;

      const nuevoArchivo = await archivoService.subirArchivo({
        nombre: req.file.originalname,
        url,
        tipo: req.body.tipo || 'imagen',
        idProyecto: req.body.idProyecto,
      });

      res.status(201).json(nuevoArchivo);
    } catch (err) {
      console.error('[ArchivoController.subir] Error:', err);
      res.status(500).json({ error: 'Error al subir el archivo' });
    }
  }

    async descargar(req, res) {
    try {
        const archivo = await archivoService.obtenerPorId(req.params.id);
        const bucket = process.env.MINIO_BUCKET;
        const key = archivo.url.split('/').pop();

        const stream = await minioClient.getObject(bucket, key);

        // Header para visualizar directamente si es imagen, o descargar si es otro
        res.setHeader('Content-Type', archivo.tipo.startsWith('imagen') ? 'image/png' : 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${archivo.nombre}"`);

        stream.pipe(res);
    } catch (err) {
        console.error('[ArchivoController.descargar] Error:', err);
        res.status(404).json({ error: 'Archivo no encontrado o error al descargar.' });
    }
    }


  async listar(req, res) {
    try {
      const archivos = await archivoService.listarPorProyecto(req.params.idProyecto);
      res.json(archivos);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async obtener(req, res) {
    try {
      const archivo = await archivoService.obtenerPorId(req.params.id);
      res.json(archivo);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async eliminar(req, res) {
    try {
      const archivo = await archivoService.obtenerPorId(req.params.id);

      const bucket = process.env.MINIO_BUCKET;
      const key = archivo.url.split('/').pop(); // nombre del archivo en MinIO

      // Eliminar de MinIO
      await minioClient.removeObject(bucket, key);

      // Eliminar de la base de datos
      const result = await archivoService.eliminar(req.params.id);

      res.json(result);
    } catch (err) {
      console.error('[ArchivoController.eliminar] Error:', err);
      res.status(404).json({ error: err.message });
    }
  }
}

module.exports = new ArchivoController();
