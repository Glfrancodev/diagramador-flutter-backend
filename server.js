require("dotenv").config(); // 👈 SIEMPRE primero
const app = require("./src/app");
const http = require("http");
const { sequelize } = require("./src/models");
const minioClient = require('./src/config/minio.client');


const PORT = process.env.PORT || 3000;

/* ---------- Crear servidor HTTP ---------- */
const server = http.createServer(app);

/* ---------- Inicializar MinIO y DB ---------- */
(async () => {
  try {
    // ✅ Crear bucket si no existe
    const bucket = process.env.MINIO_BUCKET;
    const existe = await minioClient.bucketExists(bucket);
    if (!existe) {
      await minioClient.makeBucket(bucket);
      console.log(`✅ Bucket creado: ${bucket}`);
    } else {
      console.log(`🪣 Bucket ya existe: ${bucket}`);
    }

    // ✅ Conectar y sincronizar DB
    await sequelize.authenticate();
    console.log("✅ DB conectada");

    await sequelize.sync({ alter: true }); // ⚠️ Solo para desarrollo
    console.log("✅ Tablas listas");

    // ✅ Iniciar servidor
    server.listen(PORT, () =>
      console.log(`🚀 HTTP escuchando en puerto ${PORT}`)
    );
  } catch (err) {
    console.error("❌ Error crítico al iniciar:", err);
    process.exit(1); // 👈 salir si falla algo importante
  }
})();
