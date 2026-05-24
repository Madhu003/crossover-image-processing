import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

function resolveCredentials():
  | { accessKeyId: string; secretAccessKey: string }
  | undefined {
  const accessKeyId =
    config.aws.accessKey ?? process.env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey =
    config.aws.secretKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";

  if (!accessKeyId || !secretAccessKey) {
    return undefined;
  }

  return { accessKeyId, secretAccessKey };
}

const clientConfig = () => ({
  region: config.aws.region,
  credentials: resolveCredentials(),
});

export const s3Client = new S3Client({
  ...clientConfig(),
  followRegionRedirects: true,
});

export const dynamoClient = new DynamoDBClient(clientConfig());

export const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
