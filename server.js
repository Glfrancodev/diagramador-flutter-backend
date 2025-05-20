require("dotenv").config(); // 👈 SIEMPRE al inicio
const app = require("./src/app");
const http = require("http");
const { sequelize } = require("./src/models"); // Sequelize config
// const { Server } = require("socket.io"); // ⛔ Socket.IO deshabilitado por ahora

/* ---------- Crear servidor HTTP ---------- */
const server = http.createServer(app);

/* ---------- Configurar socket.io con CORS seguro ---------- */
// const io = new Server(server, {
//   cors: {
//     origin: process.env.CORS_ORIGIN || "*",
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
// });

/* ---------- WebSocket Events ---------- */
// io.on("connection", (socket) => {
//   console.log("🟢 Conectado:", socket.id);

//   socket.on("joinProject", ({ projectId }) => {
//     if (!projectId) return;
//     socket.join(projectId);
//     console.log(`➕ ${socket.id} entró a sala ${projectId}`);
//   });

//   socket.on("editorUpdate", (data) => {
//     if (!data.projectId) return;
//     io.to(data.projectId).emit("editorUpdate", data);
//   });

//   socket.on("tabsSnapshot", (pkt) => {
//     if (!pkt.projectId) return;
//     io.to(pkt.projectId).emit("tabsSnapshot", pkt);
//   });

//   socket.on("tabsUpdate", (data) => {
//     if (!data.projectId) return;
//     io.to(data.projectId).emit("tabsUpdate", data);
//   });

//   socket.on("cursorMove", (pkt) => {
//     if (!pkt.projectId) return;
//     socket.to(pkt.projectId).emit("cursorMove", { ...pkt, socketId: socket.id });
//   });

//   socket.on("cursorLeave", ({ projectId, socketId }) => {
//     if (projectId) io.to(projectId).emit("cursorLeave", { socketId });
//   });

//   socket.on("disconnect", () => {
//     console.log("🔴 Desconectado:", socket.id);
//     socket.rooms.forEach((room) => {
//       if (room !== socket.id) io.to(room).emit("cursorLeave", { socketId: socket.id });
//     });
//   });
// });

/* ---------- Levantar el servidor ---------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 HTTP escuchando en puerto ${PORT}`)
);

/* ---------- Conexión y sincronización con PostgreSQL ---------- */
sequelize.authenticate()
  .then(() => {
    console.log("✅ DB conectada");
    return sequelize.sync({ alter: true }); // ⛔ Cambiar a false o quitar en producción
  })
  .then(() => console.log("✅ Tablas listas"))
  .catch((err) => console.error("❌ DB error:", err));
