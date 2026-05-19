import { Router } from "express";
import {
  forgotPassword,
  resetPassword,
  adminGenerateReset,
} from "../controllers/passwordResetController.js";

import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

const r = Router();

// públicos
r.post("/auth/forgot-password", forgotPassword);
r.post("/auth/reset-password", resetPassword);

// painel (precisa login)
r.post("/admin/users/:id/reset-password-link",
  requireAuth,
  requireRole(["superadmin", "admin"]),
  adminGenerateReset
);

export default r;