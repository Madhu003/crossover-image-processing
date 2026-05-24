export type FilterType = "grayscale" | "sepia" | "sharpen";

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type JobImageStatus = "pending" | "processing" | "completed" | "failed";

export interface UploadImageResponse {
  imageId: number;
  status: "processed";
  processedUrl: string;
  originalS3Key: string;
  processedS3Key: string;
}

export interface PipelineStep {
  filter: FilterType;
}

export interface PipelineDefinition {
  pipelineVersion: number;
  steps: PipelineStep[];
}

export interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
  totalImages: number;
  pollUrl: string;
}

export interface JobImageSummary {
  imageId: number;
  status: JobImageStatus;
  processedUrl?: string;
  failedReason?: string;
}

export interface GetJobResponse {
  jobId: string;
  organizationId: string;
  status: JobStatus;
  pipeline: PipelineDefinition;
  totalImages: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  processingCount: number;
  createdAt: string;
  updatedAt: string;
  images?: JobImageSummary[];
}

export interface ApiErrorBody {
  error: string;
}

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "completed",
  "completed_with_errors",
  "failed",
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}
