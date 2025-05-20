const jwt = require('jsonwebtoken');
const usuarioService = require('../services/usuario.service');

class AuthController {
  async login(req, res) {
    try {
      const { correo, password } = req.body;
      const usuario = await usuarioService.login(correo, password);

      if (!usuario.estado) {
        return res.status(403).json({ error: 'Usuario inactivo' });
      }

      const token = jwt.sign(
        { idUsuario: usuario.idUsuario, correo: usuario.correo },
        process.env.JWT_SECRET,
        { expiresIn: '4h' }
      );

      res.json({ token });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  }
}

module.exports = new AuthController();
