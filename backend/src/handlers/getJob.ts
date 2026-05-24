import { config } from "../config.js";
import type { GetJobResponse, JobImageSummary } from "../models/entities.js";
import { waitForJobTerminal } from "../services/jobProcessor.js";
import { db } from "../storage/dynamodb.js";
import { s3 } from "../storage/s3.js";
import { JobError } from "./createJob.js";

const DEFAULT_LONG_POLL_MS = 25_000;
const MAX_LONG_POLL_MS = 30_000;

function parseLongPollTimeout(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LONG_POLL_MS;
  }
  return Math.min(parsed, MAX_LONG_POLL_MS);
}

async function buildJobImages(
  organizationId: string,
  jobId: string,
): Promise<JobImageSummary[]> {
  const images = await db.listJobImages(organizationId, jobId);
  const sorted = [...images].sort((a, b) => a.imageId - b.imageId);

  return Promise.all(
    sorted.map(async (image) => {
      const summary: JobImageSummary = {
        imageId: image.imageId,
        status: image.status,
      };

      if (image.status === "completed" && image.processedS3Key) {
        summary.processedUrl = await s3.getSignedUrl(image.processedS3Key);
      }
      if (image.failedReason) {
        summary.failedReason = image.failedReason;
      }

      return summary;
    }),
  );
}

export async function handleGetJob(options: {
  jobId: string;
  organizationId?: string;
  wait?: boolean;
  timeoutMs?: number;
  includeImages?: boolean;
}): Promise<GetJobResponse> {
  const organizationId =
    options.organizationId ?? config.defaultOrganizationId;

  if (options.wait) {
    await waitForJobTerminal(
      organizationId,
      options.jobId,
      parseLongPollTimeout(options.timeoutMs),
    );
  }

  const job = await db.getJob(organizationId, options.jobId);
  if (!job) {
    throw new JobError(`Job not found: ${options.jobId}`, 404);
  }

  const pendingCount =
    job.totalImages -
    job.completedCount -
    job.failedCount -
    job.processingCount;

  const response: GetJobResponse = {
    jobId: job.jobId,
    organizationId: job.organizationId,
    status: job.status,
    pipeline: job.pipeline,
    totalImages: job.totalImages,
    completedCount: job.completedCount,
    failedCount: job.failedCount,
    pendingCount: Math.max(0, pendingCount),
    processingCount: job.processingCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  if (options.includeImages) {
    response.images = await buildJobImages(organizationId, options.jobId);
  }

  return response;
}

export async function handleGetJobImages(
  jobId: string,
  organizationId?: string,
): Promise<JobImageSummary[]> {
  const orgId = organizationId ?? config.defaultOrganizationId;
  const job = await db.getJob(orgId, jobId);
  if (!job) {
    throw new JobError(`Job not found: ${jobId}`, 404);
  }
  return buildJobImages(orgId, jobId);
}
