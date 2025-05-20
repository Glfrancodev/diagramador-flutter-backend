const Invitacion = require('../models/invitacion.model');
const Proyecto = require('../models/proyecto.model');
const Usuario = require('../models/usuario.model');

class InvitacionService {
  async crear(data, idUsuarioPropietario) {
    const proyecto = await Proyecto.findByPk(data.idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');

    if (proyecto.idUsuario !== idUsuarioPropietario) {
      throw new Error('No tienes permiso para invitar en este proyecto');
    }

    const usuarioInvitado = await Usuario.findByPk(data.idUsuario);
    if (!usuarioInvitado) throw new Error('Usuario invitado no encontrado');

    return await Invitacion.create(data);
  }

  async listarPorProyecto(idProyecto, idUsuarioPropietario) {
    const proyecto = await Proyecto.findByPk(idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');

    if (proyecto.idUsuario !== idUsuarioPropietario) {
      throw new Error('No tienes permiso para ver las invitaciones de este proyecto');
    }

    return await Invitacion.findAll({ where: { idProyecto } });
  }

  async obtenerPorId(idInvitacion, idUsuarioActual) {
    const invitacion = await Invitacion.findByPk(idInvitacion);
    if (!invitacion) throw new Error('Invitación no encontrada');
  
    const proyecto = await Proyecto.findByPk(invitacion.idProyecto);
    if (!proyecto) throw new Error('Proyecto no encontrado');
  
    // Permitir solo si es el dueño o el invitado
    if (invitacion.idUsuario !== idUsuarioActual && proyecto.idUsuario !== idUsuarioActual) {
      throw new Error('No tienes permiso para ver esta invitación');
    }
  
    return invitacion;
  }
  

  async actualizar(idInvitacion, idUsuarioActual, data) {
    const invitacion = await Invitacion.findByPk(idInvitacion);
    if (!invitacion) throw new Error('Invitación no encontrada');
  
    // Verificar que quien modifica sea el usuario invitado
    if (invitacion.idUsuario !== idUsuarioActual) {
      throw new Error('No tienes permiso para modificar esta invitación');
    }
  
    // No se puede cambiar si ya fue aceptada o rechazada
    if (invitacion.estado !== 'pendiente') {
      throw new Error('Esta invitación ya fue respondida y no se puede modificar');
    }
  
    // Solo permitir cambiar el estado
    if (!['aceptada', 'rechazada'].includes(data.estado)) {
      throw new Error('Estado inválido');
    }
  
    await invitacion.update({ estado: data.estado });
    return invitacion;
  }
  

  async eliminar(idInvitacion, idUsuarioPropietario) {
    const invitacion = await Invitacion.findByPk(idInvitacion);
    if (!invitacion) throw new Error('Invitación no encontrada');

    const proyecto = await Proyecto.findByPk(invitacion.idProyecto);
    if (!proyecto || proyecto.idUsuario !== idUsuarioPropietario) {
      throw new Error('No tienes permiso para eliminar esta invitación');
    }

    await invitacion.destroy();
    return { mensaje: 'Invitación eliminada correctamente' };
  }

  async listarPendientesPorUsuario(idUsuario) {
    return await Invitacion.findAll({
      where: {
        idUsuario,
        estado: 'pendiente'
      }
    });
  }
  

}

module.exports = new InvitacionService();
