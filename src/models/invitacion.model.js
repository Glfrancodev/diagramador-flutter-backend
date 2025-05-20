const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Proyecto = require('./proyecto.model');
const Usuario = require('./usuario.model');

const Invitacion = sequelize.define('Invitacion', {
  idInvitacion: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  estado: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pendiente'
  },
  fechaInvitacion: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  idProyecto: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Proyecto,
      key: 'idProyecto'
    },
    onDelete: 'CASCADE'
  },
  idUsuario: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Usuario,
      key: 'idUsuario'
    },
    onDelete: 'CASCADE'
  }
}, {
  tableName: 'invitaciones',
  timestamps: false
});

// Relación: Invitacion pertenece a Proyecto y Usuario
Invitacion.belongsTo(Proyecto, { foreignKey: 'idProyecto' });
Proyecto.hasMany(Invitacion, { foreignKey: 'idProyecto' });

Invitacion.belongsTo(Usuario, { foreignKey: 'idUsuario' });
Usuario.hasMany(Invitacion, { foreignKey: 'idUsuario' });

module.exports = Invitacion;
