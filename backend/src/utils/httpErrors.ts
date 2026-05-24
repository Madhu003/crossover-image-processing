import { config } from "../config.js";
import { UploadImageError } from "../handlers/uploadImage.js";
import { JobError } from "../handlers/createJob.js";

export function mapUploadError(error: unknown): {
  statusCode: number;
  body: { error: string };
} {
  if (error instanceof UploadImageError) {
    return { statusCode: error.statusCode, body: { error: error.message } };
  }

  const awsType = (error as { __type?: string }).__type ?? "";
  if (awsType.includes("ResourceNotFoundException")) {
    return {
      statusCode: 503,
      body: {
        error: `DynamoDB table "${config.aws.dynamoTable}" not found in ${config.aws.region}.`,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: error instanceof Error ? error.message : "Internal server error",
    },
  };
}

export function mapJobError(error: unknown): {
  statusCode: number;
  body: { error: string };
} {
  if (error instanceof JobError) {
    return { statusCode: error.statusCode, body: { error: error.message } };
  }
  return mapUploadError(error);
}
