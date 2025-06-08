const Archivo = require('../models/archivo.model');

class ArchivoService {
  async subirArchivo(data) {
    return await Archivo.create(data);
  }

  async listarPorProyecto(idProyecto) {
    return await Archivo.findAll({ where: { idProyecto } });
  }

  async eliminar(idArchivo) {
    const archivo = await Archivo.findByPk(idArchivo);
    if (!archivo) throw new Error('Archivo no encontrado');
    await archivo.destroy();
    return { mensaje: 'Archivo eliminado' };
  }

  async obtenerPorId(idArchivo) {
    const archivo = await Archivo.findByPk(idArchivo);
    if (!archivo) throw new Error('Archivo no encontrado');
    return archivo;
  }
}

module.exports = new ArchivoService();
