import { Request, Response, NextFunction } from "express";
import { roomService } from "../service/roomService";

export const createRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description } = req.body;
    const creatorId = req.user.id;
    const room = await roomService.createRoom(name, description, creatorId);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
};

export const getRoomByCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    
    // ⬅️ SOLUCIÓN: Validar que code existe
    if (!code) {
      return res.status(400).json({ message: "Código de sala requerido" });
    }
    
    const room = await roomService.getRoomByCode(code);
    res.json(room);
  } catch (err) {
    next(err);
  }
};

export const getActiveRooms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rooms = await roomService.getActiveRooms();
    res.json(rooms);
  } catch (err) {
    next(err);
  }
};

export const getUserRooms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id;
    const rooms = await roomService.getUserRooms(userId);
    res.json(rooms);
  } catch (err) {
    next(err);
  }
};

export const closeRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // ⬅️ SOLUCIÓN: Validar que id existe
    if (!id) {
      return res.status(400).json({ message: "ID de sala requerido" });
    }
    
    const userId = req.user.id;
    await roomService.closeRoom(Number(id), userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const updateRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    if (!id) {
      return res.status(400).json({ message: "ID de sala requerido" });
    }
    
    if (!name) {
      return res.status(400).json({ message: "El nombre es requerido" });
    }
    
    const userId = req.user.id;
    const room = await roomService.updateRoom(Number(id), userId, name, description);
    res.json(room);
  } catch (err) {
    next(err);
  }
};