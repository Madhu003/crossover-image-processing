import type { FilterType, PipelineDefinition } from "../models/entities.js";
import { applyFilter } from "./imageProcessor.js";
import { db, generateImageId } from "../storage/dynamodb.js";
import { s3 } from "../storage/s3.js";
import { decodeBase64Image } from "../utils/base64.js";
import { extensionFromBuffer } from "../utils/imageFormat.js";
import { config } from "../config.js";

const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

function computeJobStatus(
  totalImages: number,
  completedCount: number,
  failedCount: number,
): "processing" | "completed" | "completed_with_errors" | "failed" {
  const terminal = completedCount + failedCount;
  if (terminal < totalImages) return "processing";
  if (failedCount === totalImages) return "failed";
  if (failedCount > 0) return "completed_with_errors";
  return "completed";
}

async function applyPipeline(
  input: Buffer,
  pipeline: PipelineDefinition,
): Promise<Buffer> {
  let current = input;
  for (const step of pipeline.steps) {
    current = await applyFilter(current, step.filter);
  }
  return current;
}

async function processJobImage(
  organizationId: string,
  jobId: string,
  imageId: number,
  imageBase64: string,
  pipeline: PipelineDefinition,
): Promise<void> {
  await db.updateJobImageStatus(organizationId, jobId, imageId, {
    status: "processing",
  });
  await db.incrementJobCounters(organizationId, jobId, { processingCount: 1 });

  try {
    const imageBytes = decodeBase64Image(imageBase64);
    if (imageBytes.length > config.maxUploadBytes) {
      throw new Error(
        `Image exceeds maximum size of ${config.maxUploadBytes} bytes`,
      );
    }

    const ext = extensionFromBuffer(imageBytes);
    const originalS3Key = `jobs/${jobId}/original/${imageId}.${ext}`;
    const processedS3Key = `jobs/${jobId}/processed/${imageId}.${ext}`;

    await s3.putObject(originalS3Key, imageBytes);
    const processedBytes = await applyPipeline(imageBytes, pipeline);
    await s3.putObject(processedS3Key, processedBytes);

    await db.updateJobImageStatus(organizationId, jobId, imageId, {
      status: "completed",
      originalS3Key,
      processedS3Key,
    });
    await db.incrementJobCounters(organizationId, jobId, {
      completedCount: 1,
      processingCount: -1,
    });
  } catch (error) {
    const failedReason =
      error instanceof Error ? error.message : "Processing failed";
    await db.updateJobImageStatus(organizationId, jobId, imageId, {
      status: "failed",
      failedReason,
    });
    await db.incrementJobCounters(organizationId, jobId, {
      failedCount: 1,
      processingCount: -1,
    });
  }
}

async function finalizeJob(organizationId: string, jobId: string): Promise<void> {
  const job = await db.getJob(organizationId, jobId);
  if (!job) return;

  const status = computeJobStatus(
    job.totalImages,
    job.completedCount,
    job.failedCount,
  );
  await db.updateJobStatus(organizationId, jobId, status);
}

async function runJob(
  organizationId: string,
  jobId: string,
  imageIds: number[],
  images: string[],
  pipeline: PipelineDefinition,
): Promise<void> {
  await db.updateJobStatus(organizationId, jobId, "processing");

  for (let index = 0; index < images.length; index++) {
    await processJobImage(
      organizationId,
      jobId,
      imageIds[index]!,
      images[index]!,
      pipeline,
    );
  }

  await finalizeJob(organizationId, jobId);
}

/** In-process queue simulating SQS workers for local development. */
export function enqueueJobProcessing(
  organizationId: string,
  jobId: string,
  imageIds: number[],
  images: string[],
  pipeline: PipelineDefinition,
): void {
  setImmediate(() => {
    runJob(organizationId, jobId, imageIds, images, pipeline).catch((error) => {
      console.error(`Job ${jobId} failed:`, error);
      db.updateJobStatus(organizationId, jobId, "failed").catch((updateError) => {
        console.error(`Failed to mark job ${jobId} as failed:`, updateError);
      });
    });
  });
}

export async function createJobImageRecords(
  organizationId: string,
  jobId: string,
  count: number,
): Promise<number[]> {
  const now = new Date().toISOString();
  const imageIds: number[] = [];

  for (let i = 0; i < count; i++) {
    const imageId = generateImageId() + i;
    imageIds.push(imageId);
    await db.putJobImage({
      jobId,
      organizationId,
      imageId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  return imageIds;
}

export function validatePipeline(pipeline: PipelineDefinition): void {
  if (!pipeline?.steps?.length) {
    throw new Error("Pipeline must include at least one step");
  }

  const allowed: FilterType[] = ["grayscale", "sepia", "sharpen"];
  for (const step of pipeline.steps) {
    if (!allowed.includes(step.filter)) {
      throw new Error(`Unsupported filter: ${step.filter}`);
    }
  }
}

export async function waitForJobTerminal(
  organizationId: string,
  jobId: string,
  timeoutMs: number,
  pollIntervalMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await db.getJob(organizationId, jobId);
    if (!job) return;
    if (isTerminalJobStatus(job.status)) return;
    await sleep(Math.min(pollIntervalMs, deadline - Date.now()));
  }
}

export { isTerminalJobStatus, computeJobStatus };
