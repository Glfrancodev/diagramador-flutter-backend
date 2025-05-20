const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario.model');

class UsuarioService {
  async crear(data) {
    const { nombre, correo, password } = data;

    // Verificamos si ya existe ese correo
    const existe = await Usuario.findOne({ where: { correo } });
    if (existe) {
      throw new Error('El correo ya está registrado');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const usuario = await Usuario.create({
      nombre,
      correo,
      password: hashedPassword
    });

    return usuario;
  }

  async listar() {
    return await Usuario.findAll({
      attributes: { exclude: ['password'] }
    });
  }

  async listarActivos() {
    return await Usuario.findAll({
      where: { estado: true },
      attributes: { exclude: ['password'] }
    });
  }

  async obtenerPorId(id) {
    const usuario = await Usuario.findByPk(id, {
      attributes: { exclude: ['password'] }
    });
    if (!usuario) throw new Error('Usuario no encontrado');
    return usuario;
  }

  async actualizar(id, data) {
    const usuario = await Usuario.findByPk(id);
    if (!usuario) throw new Error('Usuario no encontrado');

    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    await usuario.update(data);
    return usuario;
  }

  async cambiarEstado(id) {
    const usuario = await Usuario.findByPk(id);
    if (!usuario) throw new Error('Usuario no encontrado');
  
    const nuevoEstado = !usuario.estado; // Invertir estado
  
    await usuario.update({ estado: nuevoEstado });
    return { mensaje: `Usuario ${nuevoEstado ? 'activado' : 'desactivado'} correctamente` };
  }
  
  

  async login(correo, password) {
    const usuario = await Usuario.findOne({ where: { correo } });
    if (!usuario) throw new Error('Correo o contraseña incorrecta');

    const coincide = await bcrypt.compare(password, usuario.password);
    if (!coincide) throw new Error('Correo o contraseña incorrecta');

    return usuario;
  }

  async perfil(idUsuario) {
    const usuario = await Usuario.findByPk(idUsuario, {
      attributes: { exclude: ['password'] }
    });
  
    if (!usuario) {
      throw new Error('Usuario no encontrado');
    }
  
    return usuario;
  }
  

}

module.exports = new UsuarioService();
