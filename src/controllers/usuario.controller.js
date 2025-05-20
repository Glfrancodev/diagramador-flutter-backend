const usuarioService = require('../services/usuario.service');

class UsuarioController {
  async crear(req, res) {
    try {
      const usuario = await usuarioService.crear(req.body);
      res.status(201).json(usuario);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async listar(req, res) {
    const usuarios = await usuarioService.listar();
    res.json(usuarios);
  }

  async obtener(req, res) {
    try {
      const usuario = await usuarioService.obtenerPorId(req.params.id);
      res.json(usuario);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async actualizar(req, res) {
    try {
      const usuario = await usuarioService.actualizar(req.params.id, req.body);
      res.json(usuario);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async cambiarEstado(req, res) {
    try {
      const resultado = await usuarioService.cambiarEstado(req.params.id);
      res.json(resultado);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
  
  async listarActivos(req, res) {
    const usuarios = await usuarioService.listarActivos();
    res.json(usuarios);
  }
  
  async perfil(req, res) {
    try {
      const usuario = await usuarioService.perfil(req.usuario.idUsuario);
      res.json(usuario);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }
  
  
}

module.exports = new UsuarioController();
