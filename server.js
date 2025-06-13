require("dotenv").config(); // 👈 SIEMPRE al inicio

const app          = require("./src/app");
const http         = require("http");
const { Server }   = require("socket.io");
const { sequelize } = require("./src/models");
const minioClient  = require("./src/config/minio.client");

/* ---------- Crear servidor HTTP ---------- */
const server = http.createServer(app);

/* ---------- WebSocket con Socket.IO ---------- */
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*", // ✅ define esto en Railway en producción
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/* ---------- Eventos WebSocket ---------- */
io.on("connection", (socket) => {
  console.log("🟢 Conectado:", socket.id);

  socket.on("joinProject", ({ projectId }) => {
    if (!projectId) return;
    socket.join(projectId);
    console.log(`➕ ${socket.id} entró a sala ${projectId}`);
  });

  socket.on("canvasUpdate", (data) => {
    if (!data.projectId) return;
    io.to(data.projectId).emit("canvasUpdate", data);
  });

  socket.on("tabsSnapshot", (data) => {
    if (!data.projectId) return;
    io.to(data.projectId).emit("tabsSnapshot", data);
  });

  socket.on("tabsUpdate", (data) => {
    if (!data.projectId) return;
    io.to(data.projectId).emit("tabsUpdate", data);
  });

  socket.on("cursorMove", (data) => {
    if (!data.projectId) return;
    socket.to(data.projectId).emit("cursorMove", { ...data, socketId: socket.id });
  });

  socket.on("cursorLeave", ({ projectId, socketId }) => {
    if (projectId) {
      io.to(projectId).emit("cursorLeave", { socketId });
    }
  });

  socket.on("selectElement", (data) => {
    if (!data.projectId) return;
    socket.to(data.projectId).emit("selectElement", { ...data, socketId: socket.id });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Desconectado:", socket.id);
    socket.rooms.forEach((room) => {
      if (room !== socket.id) io.to(room).emit("cursorLeave", { socketId: socket.id });
    });
  });
});

/* ---------- Inicializar MinIO y Sequelize ---------- */
(async () => {
  try {
    const bucket = process.env.MINIO_BUCKET;
    const existe = await minioClient.bucketExists(bucket);
    if (!existe) {
      await minioClient.makeBucket(bucket);
      console.log(`✅ Bucket creado: ${bucket}`);
    } else {
      console.log(`🪣 Bucket ya existe: ${bucket}`);
    }

    await sequelize.authenticate();
    console.log("✅ DB conectada");

    await sequelize.sync({ alter: true }); // ⚠️ cambiar en producción
    console.log("✅ Tablas listas");

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () =>
      console.log(`🚀 HTTP + WebSocket escuchando en puerto ${PORT}`)
    );
  } catch (err) {
    console.error("❌ Error crítico al iniciar:", err);
    process.exit(1);
  }
})();
