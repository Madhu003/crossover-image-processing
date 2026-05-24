import { config } from "../config.js";
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobRecord,
} from "../models/entities.js";
import {
  createJobImageRecords,
  enqueueJobProcessing,
  validatePipeline,
} from "../services/jobProcessor.js";
import { db, generateJobId } from "../storage/dynamodb.js";

export class JobError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export async function handleCreateJob(
  body: CreateJobRequest,
): Promise<CreateJobResponse> {
  if (!body?.images?.length) {
    throw new JobError("Missing required field: images", 400);
  }

  if (body.images.length > 50) {
    throw new JobError("Maximum 50 images per job", 400);
  }

  const organizationId =
    body.organizationId ?? config.defaultOrganizationId;

  try {
    await db.requireOrganization(organizationId);
  } catch {
    throw new JobError(`Organization not found: ${organizationId}`, 404);
  }

  try {
    validatePipeline(body.pipeline);
  } catch (error) {
    throw new JobError(
      error instanceof Error ? error.message : "Invalid pipeline",
      400,
    );
  }

  const jobId = generateJobId();
  const now = new Date().toISOString();
  const totalImages = body.images.length;

  const job: JobRecord = {
    jobId,
    organizationId,
    status: "pending",
    pipeline: {
      pipelineVersion: body.pipeline.pipelineVersion ?? 1,
      steps: body.pipeline.steps,
    },
    totalImages,
    completedCount: 0,
    failedCount: 0,
    processingCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.putJob(job);
  const imageIds = await createJobImageRecords(organizationId, jobId, totalImages);

  enqueueJobProcessing(
    organizationId,
    jobId,
    imageIds,
    body.images,
    job.pipeline,
  );

  return {
    jobId,
    status: "pending",
    totalImages,
    pollUrl: `${config.publicBaseUrl}/jobs/${jobId}`,
  };
}
