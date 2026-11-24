import { Router } from "express";
import { loginController, googleLoginController, refreshTokenController, logoutController, switchProfileController } from "../controllers/authControllers";
import { auth, authRefresh } from "../adapters/auth/authPermisos";
import { usuarioContextoController } from "../controllers/usuarioContextoController";
import { allRoles } from "../types/roles";
import { authLimiter } from "../adapters/middlewares/rateLimiter";

const authRouter = Router();

authRouter.post("/login", authLimiter, loginController);
authRouter.post("/google", authLimiter, googleLoginController);
authRouter.post("/refresh", authRefresh(allRoles), refreshTokenController);
authRouter.post("/switch-profile", authRefresh(allRoles), switchProfileController);
authRouter.post("/logout", logoutController);

// Ruta protegida para obtener contexto de usuario por accessToken
authRouter.get("/context", auth(allRoles), usuarioContextoController);

export default authRouter;