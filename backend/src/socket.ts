import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export const setIo = (server: SocketIOServer) => {
  io = server;
};

export const getIo = () => {
  if (!io) throw new Error("Socket.io no inicializado");
  return io as SocketIOServer;
};

export default { setIo, getIo };
