const Proyecto = require('../models/proyecto.model');
const Invitacion = require('../models/invitacion.model');

class ProyectoService {
  async crear(data) {
    return await Proyecto.create(data);
  }

  async listar() {
    return await Proyecto.findAll();
  }

  async listarPorUsuario(idUsuario) {
    return await Proyecto.findAll({ where: { idUsuario } });
  }

  async obtenerPorId(idProyecto) {
    const proyecto = await Proyecto.findByPk(idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');
    return proyecto;
  }

  async actualizar(idProyecto, idUsuario, data) {
    const proyecto = await Proyecto.findByPk(idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');
  
    // Si el usuario es el dueño, puede actualizar
    if (proyecto.idUsuario === idUsuario) {
      await proyecto.update(data);
      return proyecto;
    }
  
    // Si no es el dueño, verificamos si tiene invitación aceptada
    const invitacion = await Invitacion.findOne({
      where: {
        idProyecto,
        idUsuario,
        estado: 'aceptada'
      }
    });
  
    if (!invitacion) {
      throw new Error('No tienes permiso para actualizar este proyecto');
    }
  
    // Si tiene invitación aceptada, puede actualizar
    await proyecto.update(data);
    return proyecto;
  }
  
  

  async eliminar(idProyecto, idUsuario) {
    const proyecto = await Proyecto.findByPk(idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');
  
    if (proyecto.idUsuario !== idUsuario) {
      throw new Error('No tienes permiso para eliminar este proyecto');
    }
  
    await proyecto.destroy();
    return { mensaje: 'Proyecto eliminado correctamente' };
  }

  async listarProyectosPermitidos(idUsuario) {
    // Proyectos propios
    const proyectosPropios = await Proyecto.findAll({
      where: { idUsuario }
    });
  
    // Proyectos donde estoy invitado y acepté
    const invitacionesAceptadas = await Invitacion.findAll({
      where: {
        idUsuario,
        estado: 'aceptada'
      }
    });
  
    const proyectosInvitadoIds = invitacionesAceptadas.map(inv => inv.idProyecto);
  
    const proyectosInvitados = await Proyecto.findAll({
      where: {
        idProyecto: proyectosInvitadoIds
      }
    });
  
    // Unimos ambas listas
    return [...proyectosPropios, ...proyectosInvitados];
  }
  
  async listarProyectosInvitado(idUsuario) {
    // Buscar todas las invitaciones aceptadas
    const invitacionesAceptadas = await Invitacion.findAll({
      where: {
        idUsuario,
        estado: 'aceptada'
      }
    });
  
    const proyectosIds = invitacionesAceptadas.map(inv => inv.idProyecto);
  
    if (proyectosIds.length === 0) {
      return [];
    }
  
    // Buscar los proyectos relacionados
    return await Proyecto.findAll({
      where: {
        idProyecto: proyectosIds
      }
    });
  }
  

}

module.exports = new ProyectoService();
