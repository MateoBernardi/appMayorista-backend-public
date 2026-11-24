import { Router } from "express";
import { getAllSuscripciones, getSuscripcionById, getSuscripcionByEmail, deleteSuscripcion } from "../controllers/web/suscripcionesController";

const SuscripcionRouter = Router();

SuscripcionRouter.get("/", getAllSuscripciones);
SuscripcionRouter.get("/:id", getSuscripcionById);
SuscripcionRouter.get("/email/:email", getSuscripcionByEmail);
SuscripcionRouter.delete("/:id", deleteSuscripcion);

export default SuscripcionRouter;
