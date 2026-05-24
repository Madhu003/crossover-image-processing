import { config } from "../config.js";
import type {
  FilterType,
  ImageRecord,
  UploadImageRequest,
  UploadImageResponse,
} from "../models/entities.js";
import { applyFilter } from "../services/imageProcessor.js";
import { db, generateImageId } from "../storage/dynamodb.js";
import { s3 } from "../storage/s3.js";
import { decodeBase64Image } from "../utils/base64.js";

const DEFAULT_FILTER: FilterType = "grayscale";

function extensionFromBuffer(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "gif";
  }
  if (
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  return "bin";
}

export class UploadImageError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "UploadImageError";
  }
}

export async function handleUploadImage(
  body: UploadImageRequest,
): Promise<UploadImageResponse> {
  if (!body?.image) {
    throw new UploadImageError("Missing required field: image", 400);
  }

  const organizationId =
    body.organizationId ?? config.defaultOrganizationId;
  const filter = body.filter ?? DEFAULT_FILTER;

  try {
    await db.requireOrganization(organizationId);
  } catch {
    throw new UploadImageError(
      `Organization not found: ${organizationId}`,
      404,
    );
  }

  const imageBytes = decodeBase64Image(body.image);
  if (imageBytes.length > config.maxUploadBytes) {
    throw new UploadImageError(
      `Image exceeds maximum size of ${config.maxUploadBytes} bytes`,
      413,
    );
  }

  const imageId = generateImageId();
  const ext = extensionFromBuffer(imageBytes);
  const originalS3Key = `original/${organizationId}/${imageId}.${ext}`;
  const processedS3Key = `processed/${organizationId}/${imageId}.${ext}`;

  const createdAt = new Date().toISOString();

  const uploadedRecord: ImageRecord = {
    imageId,
    organizationId,
    status: "uploaded",
    originalS3Key,
    filter,
    createdAt,
  };

  await s3.putObject(originalS3Key, imageBytes);
  await db.putImage(uploadedRecord);

  const processedBytes = await applyFilter(imageBytes, filter);
  await s3.putObject(processedS3Key, processedBytes);

  const processedRecord: ImageRecord = {
    ...uploadedRecord,
    status: "processed",
    processedS3Key,
  };
  await db.putImage(processedRecord);

  return {
    imageId,
    status: "processed",
    processedUrl: await s3.getSignedUrl(processedS3Key),
    originalS3Key,
    processedS3Key,
  };
}
