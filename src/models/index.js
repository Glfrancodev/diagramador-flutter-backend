const sequelize = require('../config/database');

const Usuario = require('./usuario.model'); // aún no existe, pero lo haremos enseguida

const db = {
  sequelize,
  Usuario
};

module.exports = db;
