import { Router } from "express";
import { sendMailController } from "../controllers/mailController";

const mailRouter = Router();
mailRouter.post("/", sendMailController);

export default mailRouter;
