import { Router } from "express";
import { handleCreateJob } from "../handlers/createJob.js";
import { handleGetJob, handleGetJobImages } from "../handlers/getJob.js";
import type { CreateJobRequest } from "../models/entities.js";
import { mapJobError } from "../utils/httpErrors.js";

export const jobsRouter = Router();

jobsRouter.post("/", async (req, res) => {
  try {
    const result = await handleCreateJob(req.body as CreateJobRequest);
    res.status(202).json(result);
  } catch (error) {
    console.error("POST /jobs failed:", error);
    const mapped = mapJobError(error);
    res.status(mapped.statusCode).json(mapped.body);
  }
});

jobsRouter.get("/:jobId", async (req, res) => {
  try {
    const wait = req.query.wait === "true" || req.query.wait === "1";
    const includeImages =
      req.query.includeImages === "true" || req.query.includeImages === "1";
    const timeoutMs = req.query.timeout
      ? Number(req.query.timeout)
      : undefined;

    const result = await handleGetJob({
      jobId: req.params.jobId,
      organizationId:
        typeof req.query.organizationId === "string"
          ? req.query.organizationId
          : undefined,
      wait,
      timeoutMs,
      includeImages,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error(`GET /jobs/${req.params.jobId} failed:`, error);
    const mapped = mapJobError(error);
    res.status(mapped.statusCode).json(mapped.body);
  }
});

jobsRouter.get("/:jobId/images", async (req, res) => {
  try {
    const images = await handleGetJobImages(
      req.params.jobId,
      typeof req.query.organizationId === "string"
        ? req.query.organizationId
        : undefined,
    );
    res.status(200).json({ images });
  } catch (error) {
    console.error(`GET /jobs/${req.params.jobId}/images failed:`, error);
    const mapped = mapJobError(error);
    res.status(mapped.statusCode).json(mapped.body);
  }
});
