import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { app, port } from "./app";
import errorHanddler from "./middleware/errorHanddler";
import jwt from "jsonwebtoken";
import { chatService } from "./service/chatService";
import { pollService } from "./service/pollService";
import { roomService } from "./service/roomService";
import { setIo } from "./socket";
import prisma from "./config/database";

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"],
    credentials: true,
  }
});

// export io instance to other modules via socket holder
setIo(io);

// Middleware de autenticación para Socket.io
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      throw new Error("Token no proporcionado");
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET || "secret");
    socket.data.user = payload;
    next();
  } catch (err) {
    console.error("Socket auth error:", err);
    next(new Error("Token inválido"));
  }
});

io.on("connection", (socket) => {
  console.log("Socket conectado:", socket.id, "Usuario:", socket.data.user.username);

  // Inicializar lista de salas del usuario
  socket.data.rooms = [];

  // Unirse a una sala
  socket.on("joinRoom", (roomCode: string) => {
    socket.join(`room-${roomCode}`);
    // Agregar sala a la lista del usuario si no está ya
    if (!socket.data.rooms.includes(roomCode)) {
      socket.data.rooms.push(roomCode);
    }
    console.log(`${socket.data.user.username} se unió a la sala ${roomCode}`);

    // Obtener todos los sockets en la sala DESPUÉS de que este usuario se ha unido
    const roomSockets = io.sockets.adapter.rooms.get(`room-${roomCode}`);
    const connectedUsers = [];

    if (roomSockets) {
      for (const socketId of roomSockets) {
        const roomSocket = io.sockets.sockets.get(socketId);
        if (roomSocket && roomSocket.data.user) {
          connectedUsers.push({
            username: roomSocket.data.user.username,
            userId: roomSocket.data.user.id
          });
        }
      }
    }

    // Enviar lista completa actualizada a TODOS en la sala (incluyendo al nuevo usuario)
    io.to(`room-${roomCode}`).emit("roomUsers", connectedUsers);
  });

  // Salir de una sala
  socket.on("leaveRoom", (roomCode: string) => {
    socket.leave(`room-${roomCode}`);
    // Remover sala de la lista del usuario
    socket.data.rooms = socket.data.rooms.filter((r: string) => r !== roomCode);
    console.log(`${socket.data.user.username} salió de la sala ${roomCode}`);

    // Obtener lista actualizada de usuarios en la sala después de que este usuario se fue
    const roomSockets = io.sockets.adapter.rooms.get(`room-${roomCode}`);
    const connectedUsers = [];

    if (roomSockets) {
      for (const socketId of roomSockets) {
        const roomSocket = io.sockets.sockets.get(socketId);
        if (roomSocket && roomSocket.data.user) {
          connectedUsers.push({
            username: roomSocket.data.user.username,
            userId: roomSocket.data.user.id
          });
        }
      }
    }

    // Enviar lista actualizada a todos los que quedan en la sala
    io.to(`room-${roomCode}`).emit("roomUsers", connectedUsers);
  });

  // Mensaje en sala específica
  socket.on("roomMessage", async (payload: { roomCode: string, content: string, roomId: number }) => {
    const user = socket.data.user;
    if (!user || !payload.content) return;

    try {
      const msg = await chatService.saveMessage(user.id, payload.content, payload.roomId);
      io.to(`room-${payload.roomCode}`).emit("newRoomMessage", msg);

      // Emitir notificaciones de menciones si hay alguna
      if (msg.mentions && msg.mentions.length > 0) {
        for (const mentionedUsername of msg.mentions) {
          // Encontrar el socket del usuario mencionado
          const sockets = io.sockets.sockets;
          for (const [socketId, socketInstance] of sockets) {
            if (socketInstance.data.user && socketInstance.data.user.username === mentionedUsername) {
              socketInstance.emit("mentionNotification", {
                messageId: msg.id,
                mentionedBy: msg.username,
                content: msg.content,
                roomCode: payload.roomCode,
                roomId: payload.roomId
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Error al guardar mensaje:", err);
    }
  });

  // Crear votación (solo moderador)
  socket.on("createPoll", async (payload: { roomCode: string, question: string, options: string[], roomId: number, deadline?: string }) => {
    try {
      console.log('Creando votación:', payload);
      const poll = await pollService.createPoll(
        payload.question,
        payload.options,
        payload.roomId,
        socket.data.user.id,
        payload.deadline
      );
      console.log('Votación creada:', poll);

      io.to(`room-${payload.roomCode}`).emit("newPoll", poll);
    } catch (err: any) {
      console.error('Error creando votación:', err);
      socket.emit("pollError", { message: err.message });
    }
  });

  // Votar
  socket.on("submitVote", async (payload: { roomCode: string, pollId: number, optionId: number }) => {
    try {
      await pollService.vote(payload.pollId, payload.optionId, socket.data.user.id);

      // Enviar resultados actualizados a todos
      const results = await pollService.getPollResults(payload.pollId);
      io.to(`room-${payload.roomCode}`).emit("pollResults", results);

      // Notificar al creador de la votación
      const poll = await prisma.poll.findUnique({
        where: { id: payload.pollId },
        include: { room: true }
      });
      if (poll && poll.room.creatorId !== socket.data.user.id) {
        // Encontrar el socket del creador
        const sockets = io.sockets.sockets;
        for (const [socketId, socketInstance] of sockets) {
          if (socketInstance.data.user && socketInstance.data.user.id === poll.room.creatorId) {
            socketInstance.emit("voteNotification", {
              pollId: payload.pollId,
              pollQuestion: poll.question,
              votedBy: socket.data.user.username,
              roomCode: payload.roomCode,
              roomId: poll.roomId
            });
            break;
          }
        }
      }
    } catch (err: any) {
      socket.emit("voteError", { message: err.message });
    }
  });

  // Cerrar votación
  socket.on("closePoll", async (payload: { roomCode: string, pollId: number }) => {
    try {
      await pollService.closePoll(payload.pollId, socket.data.user.id);
      io.to(`room-${payload.roomCode}`).emit("pollClosed", { pollId: payload.pollId });
    } catch (err: any) {
      socket.emit("pollError", { message: err.message });
    }
  });

  // Eliminar votación
  socket.on("deletePoll", async (payload: { roomCode: string, pollId: number }) => {
    try {
      await pollService.deletePoll(payload.pollId, socket.data.user.id);
      io.to(`room-${payload.roomCode}`).emit("pollDeleted", { pollId: payload.pollId });
    } catch (err: any) {
      socket.emit("pollError", { message: err.message });
    }
  });

  // Expulsar miembro
  socket.on("kickMember", async (payload: { roomCode: string, userIdToKick: number }) => {
    try {
      await roomService.kickMember(payload.roomCode, payload.userIdToKick, socket.data.user.id);

      // Notificar a todos en la sala que el usuario fue expulsado
      io.to(`room-${payload.roomCode}`).emit("memberKicked", {
        kickedUserId: payload.userIdToKick,
        kickedBy: socket.data.user.username
      });

      // Forzar desconexión del usuario expulsado
      const sockets = io.sockets.sockets;
      for (const [socketId, socketInstance] of sockets) {
        if (socketInstance.data.user && socketInstance.data.user.id === payload.userIdToKick) {
          socketInstance.emit("kicked", { roomCode: payload.roomCode });
          socketInstance.leave(`room-${payload.roomCode}`);
          break;
        }
      }
    } catch (err: any) {
      socket.emit("kickError", { message: err.message });
    }
  });





  // Chat público (mantener el anterior)
  socket.on("publicMessage", async (payload) => {
    const user = socket.data.user;
    if (!user || !payload.content) return;
    const msg = await chatService.saveMessage(user.id, payload.content);
    io.emit("newPublicMessage", msg);
  });

  socket.on("disconnect", () => {
    console.log("Socket desconectado:", socket.id, "Usuario:", socket.data.user?.username);

    // Notificar a todas las salas en las que estaba el usuario
    if (socket.data.user && socket.data.rooms) {
      for (const roomCode of socket.data.rooms) {
        const roomName = `room-${roomCode}`;
        // Obtener lista actualizada de usuarios en la sala
        const roomSockets = io.sockets.adapter.rooms.get(roomName);
        const connectedUsers = [];

        if (roomSockets) {
          for (const socketId of roomSockets) {
            const roomSocket = io.sockets.sockets.get(socketId);
            if (roomSocket && roomSocket.data.user) {
              connectedUsers.push({
                username: roomSocket.data.user.username,
                userId: roomSocket.data.user.id
              });
            }
          }
        }

        // Enviar lista actualizada a los que quedan en la sala
        io.to(roomName).emit("roomUsers", connectedUsers);
      }
    }
  });
});

app.use(errorHanddler);

server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
