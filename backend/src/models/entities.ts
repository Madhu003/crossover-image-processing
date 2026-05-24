export type Plan = "starter";

export type ImageStatus = "uploaded" | "processed";

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type JobImageStatus = "pending" | "processing" | "completed" | "failed";

export type FilterType = "grayscale" | "sepia" | "sharpen";

export type EntityType = "USER" | "ORG" | "IMAGE" | "JOB" | "JOB_IMAGE";

export interface PipelineStep {
  filter: FilterType;
}

export interface PipelineDefinition {
  pipelineVersion: number;
  steps: PipelineStep[];
}

export interface User {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Organization {
  organizationId: string;
  ownerId: string;
  memberIds: string[];
  plan: Plan;
}

export interface ImageRecord {
  organizationId: string;
  imageId: number;
  status: ImageStatus;
  originalS3Key: string;
  processedS3Key?: string;
  filter?: FilterType;
  createdAt: string;
}

/** Single-table DynamoDB item (pk + sk). */
export interface TableItemBase {
  pk: string;
  sk: string;
  entityType: EntityType;
}

export type UserItem = TableItemBase & { entityType: "USER" } & User;
export type OrganizationItem = TableItemBase & { entityType: "ORG" } & Organization;
export type ImageItem = TableItemBase & { entityType: "IMAGE" } & ImageRecord;

export interface JobRecord {
  jobId: string;
  organizationId: string;
  status: JobStatus;
  pipeline: PipelineDefinition;
  totalImages: number;
  completedCount: number;
  failedCount: number;
  processingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobImageRecord {
  jobId: string;
  organizationId: string;
  imageId: number;
  status: JobImageStatus;
  originalS3Key?: string;
  processedS3Key?: string;
  failedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type JobItem = TableItemBase & { entityType: "JOB" } & JobRecord;
export type JobImageItem = TableItemBase & { entityType: "JOB_IMAGE" } & JobImageRecord;

export type TableItem =
  | UserItem
  | OrganizationItem
  | ImageItem
  | JobItem
  | JobImageItem;

export interface UploadImageRequest {
  image: string;
  organizationId?: string;
  filter?: FilterType;
}

export interface UploadImageResponse {
  imageId: number;
  status: ImageStatus;
  processedUrl: string;
  originalS3Key: string;
  processedS3Key: string;
}

export interface CreateJobRequest {
  images: string[];
  organizationId?: string;
  pipeline: PipelineDefinition;
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
