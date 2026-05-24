import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../aws/clients.js";
import { config } from "../config.js";

function contentTypeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export class S3Storage {
  async init(): Promise<void> {
    // No local setup required for AWS S3.
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeFromKey(key),
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
      }),
    );

    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty S3 object: ${key}`);
    }
    return Buffer.from(bytes);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}

export const s3 = new S3Storage();
