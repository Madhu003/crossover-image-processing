import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

dotenv.config({ path: path.join(backendRoot, ".env") });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  maxUploadBytes: 4.5 * 1024 * 1024,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  defaultOrganizationId:
    process.env.DEFAULT_ORGANIZATION_ID ?? "org-demo-001",
  defaultUserId: process.env.DEFAULT_USER_ID ?? "user-demo-001",
  dynamodbAutoCreate: process.env.DYNAMODB_AUTO_CREATE !== "false",
  aws: {
    region: process.env.AWS_REGION ?? "us-east-1",
    accessKey: process.env.AWS_ACCESS_KEY,
    secretKey: process.env.AWS_SECRET_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET ?? "crossover-image-processing",
    dynamoTable:
      process.env.AWS_DYNAMODB_TABLE ?? "crossover-image-processing",
  },
} as const;
