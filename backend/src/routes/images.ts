import { Router } from "express";
import { handleUploadImage } from "../handlers/uploadImage.js";
import type { UploadImageRequest } from "../models/entities.js";
import { mapUploadError } from "../utils/httpErrors.js";

export const imagesRouter = Router();

imagesRouter.post("/", async (req, res) => {
  try {
    const result = await handleUploadImage(req.body as UploadImageRequest);
    res.status(200).json(result);
  } catch (error) {
    console.error("POST /images failed:", error);
    const mapped = mapUploadError(error);
    res.status(mapped.statusCode).json(mapped.body);
  }
});
