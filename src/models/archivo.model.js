const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Proyecto = require('./proyecto.model');

const Archivo = sequelize.define('Archivo', {
  idArchivo: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false // ej: 'imagen', 'audio', 'video'
  },
  fechaSubida: {
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
  }
}, {
  tableName: 'archivos',
  timestamps: false
});

Archivo.belongsTo(Proyecto, { foreignKey: 'idProyecto' });
Proyecto.hasMany(Archivo, { foreignKey: 'idProyecto' });

module.exports = Archivo;
