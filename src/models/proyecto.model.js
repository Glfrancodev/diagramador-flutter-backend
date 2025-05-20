const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Usuario = require('./usuario.model');

const Proyecto = sequelize.define('Proyecto', {
  idProyecto: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descripcion: {
    type: DataTypes.STRING,
    allowNull: true
  },
  contenido: {
    type: DataTypes.JSONB, // 👈 Importante para PostgreSQL
    allowNull: true
  },
  fechaCreacion: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
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
  tableName: 'proyectos',
  timestamps: false
});

// Relación: Proyecto pertenece a Usuario
Proyecto.belongsTo(Usuario, { foreignKey: 'idUsuario' });
Usuario.hasMany(Proyecto, { foreignKey: 'idUsuario' });

module.exports = Proyecto;
