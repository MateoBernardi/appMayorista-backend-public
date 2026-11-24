import { Router } from "express";
import {
  deleteDraftByIdController,
  deleteDrafts,
  deleteImageById,
  getDrafts,
  getGallery,
  getPreviewImages,
  publishDraftsController,
  putDraft,
  createMediaUploadUrl,
  uploadImage,
} from "../controllers/web/imagesController";

const Imagesrouter = Router();

// Rutas estáticas antes de "/:id"
Imagesrouter.get("/drafts", getDrafts);
Imagesrouter.put("/drafts", putDraft);
Imagesrouter.delete("/drafts", deleteDrafts);
Imagesrouter.post("/drafts/publish", publishDraftsController);
Imagesrouter.delete("/drafts/:id", deleteDraftByIdController);
Imagesrouter.get("/preview", getPreviewImages);
Imagesrouter.get("/gallery", getGallery);
// Subida directa a Cloudflare: acá solo se firma (upload-url) y se registra (POST /)
Imagesrouter.post("/upload-url", createMediaUploadUrl);
Imagesrouter.post("/", uploadImage);
Imagesrouter.delete("/:id", deleteImageById);

export default Imagesrouter;
