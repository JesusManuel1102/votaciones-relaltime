import { Router } from "express";
import verifyToken from "../middleware/jwt/verifyToken";
import { createRoom, getRoomByCode, getActiveRooms, getUserRooms, closeRoom, updateRoom } from "../controller/roomController";

const router = Router();

router.use(verifyToken);

router.post("/", createRoom);
router.get("/", getUserRooms); // Cambiado para devolver solo salas del usuario
router.get("/all", getActiveRooms); // Nuevo endpoint para todas las salas activas (si es necesario)
router.get("/:code", getRoomByCode);
router.put("/:id", updateRoom);
router.delete("/:id", closeRoom);

export default router;