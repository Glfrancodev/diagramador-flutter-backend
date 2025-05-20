const invitacionService = require('../services/invitacion.service');

class InvitacionController {
  async crear(req, res) {
    try {
      const invitacion = await invitacionService.crear(req.body, req.usuario.idUsuario);
      res.status(201).json(invitacion);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async listarPorProyecto(req, res) {
    try {
      const invitaciones = await invitacionService.listarPorProyecto(req.params.idProyecto, req.usuario.idUsuario);
      res.json(invitaciones);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async obtener(req, res) {
    try {
      const invitacion = await invitacionService.obtenerPorId(req.params.id, req.usuario.idUsuario);
      res.json(invitacion);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }
  

  async actualizar(req, res) {
    try {
      const invitacion = await invitacionService.actualizar(req.params.id, req.usuario.idUsuario, req.body);
      res.json(invitacion);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async eliminar(req, res) {
    try {
      const resultado = await invitacionService.eliminar(req.params.id, req.usuario.idUsuario);
      res.json(resultado);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async listarPendientes(req, res) {
    try {
      const invitaciones = await invitacionService.listarPendientesPorUsuario(req.usuario.idUsuario);
      res.json(invitaciones);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
  

}

module.exports = new InvitacionController();
