export type Plan = "starter";

export type ImageStatus = "uploaded" | "processed";

export type FilterType = "grayscale" | "sepia" | "sharpen";

export type EntityType = "USER" | "ORG" | "IMAGE";

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

export type TableItem = UserItem | OrganizationItem | ImageItem;

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
