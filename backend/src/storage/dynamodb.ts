import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import type { KeySchemaElement } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoClient, dynamoDocClient } from "../aws/clients.js";
import { config } from "../config.js";
import {
  createDemoOrganization,
  createDemoUser,
  DEMO_ORG_ID,
} from "./demoTenant.js";
import type {
  ImageItem,
  ImageRecord,
  JobImageItem,
  JobImageRecord,
  JobItem,
  JobRecord,
  Organization,
  OrganizationItem,
  User,
  UserItem,
} from "../models/entities.js";
import {
  jobImageSkPrefix,
  pkOrg,
  pkUser,
  skImage,
  skJob,
  skJobImage,
  skOrgMetadata,
  skProfile,
} from "./keys.js";

export function generateImageId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSingleTableKeySchema(keySchema: KeySchemaElement[] | undefined): boolean {
  if (!keySchema || keySchema.length !== 2) return false;
  const hash = keySchema.find((k) => k.KeyType === "HASH")?.AttributeName;
  const range = keySchema.find((k) => k.KeyType === "RANGE")?.AttributeName;
  return hash === "pk" && range === "sk";
}

function formatKeySchema(keySchema: KeySchemaElement[] | undefined): string {
  if (!keySchema?.length) return "(none)";
  return keySchema
    .map((k) => `${k.AttributeName} (${k.KeyType})`)
    .join(", ");
}

export class DynamoDBSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DynamoDBSchemaError";
  }
}

async function waitForTableActive(tableName: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { Table } = await dynamoClient.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (Table?.TableStatus === "ACTIVE") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for DynamoDB table: ${tableName}`);
}

async function waitForTableDeleted(tableName: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      const notFound =
        error instanceof ResourceNotFoundException ||
        (error as { name?: string }).name === "ResourceNotFoundException";
      if (notFound) return;
      throw error;
    }
  }
  throw new Error(`Timed out waiting for DynamoDB table deletion: ${tableName}`);
}

async function createSingleTable(tableName: string): Promise<void> {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
    }),
  );
  await waitForTableActive(tableName);
  console.log(`DynamoDB table ready: ${tableName} (pk + sk single-table)`);
}

async function describeTableKeySchema(
  tableName: string,
): Promise<KeySchemaElement[] | undefined> {
  const { Table } = await dynamoClient.send(
    new DescribeTableCommand({ TableName: tableName }),
  );
  return Table?.KeySchema;
}

function wrongSchemaMessage(
  tableName: string,
  keySchema: KeySchemaElement[] | undefined,
): string {
  return (
    `DynamoDB table "${tableName}" has the wrong key schema.\n` +
    `  Expected: pk (HASH), sk (RANGE)\n` +
    `  Found:    ${formatKeySchema(keySchema)}\n` +
    `  Your table was likely created with only "imageId" as the partition key.\n` +
    `  Fix: delete the table in AWS Console, or run:\n` +
    `    FORCE_RECREATE_DYNAMODB_TABLE=true npm run setup:dynamo`
  );
}

async function deleteTableIfExists(tableName: string): Promise<void> {
  try {
    await dynamoClient.send(new DeleteTableCommand({ TableName: tableName }));
    console.log(`Deleting table "${tableName}"…`);
    await waitForTableDeleted(tableName);
  } catch (error) {
    const notFound =
      error instanceof ResourceNotFoundException ||
      (error as { name?: string }).name === "ResourceNotFoundException";
    if (!notFound) throw error;
  }
}

/**
 * Ensures the single-table exists with pk + sk keys.
 * @param options.recreate - delete and recreate when schema is wrong (destructive)
 */
export async function ensureSingleTable(options?: {
  recreate?: boolean;
}): Promise<void> {
  const tableName = config.aws.dynamoTable;
  const forceRecreate =
    options?.recreate ?? process.env.FORCE_RECREATE_DYNAMODB_TABLE === "true";

  let keySchema: KeySchemaElement[] | undefined;
  try {
    keySchema = await describeTableKeySchema(tableName);
  } catch (error) {
    const notFound =
      error instanceof ResourceNotFoundException ||
      (error as { name?: string }).name === "ResourceNotFoundException";
    if (!notFound) throw error;

    console.log(
      `DynamoDB table "${tableName}" not found in ${config.aws.region}; creating…`,
    );
    await createSingleTable(tableName);
    return;
  }

  if (isSingleTableKeySchema(keySchema)) return;

  if (forceRecreate) {
    console.warn(wrongSchemaMessage(tableName, keySchema));
    await deleteTableIfExists(tableName);
    await createSingleTable(tableName);
    return;
  }

  throw new DynamoDBSchemaError(wrongSchemaMessage(tableName, keySchema));
}

async function assertSingleTableSchema(): Promise<void> {
  const tableName = config.aws.dynamoTable;
  let keySchema: KeySchemaElement[] | undefined;
  try {
    keySchema = await describeTableKeySchema(tableName);
  } catch (error) {
    const notFound =
      error instanceof ResourceNotFoundException ||
      (error as { name?: string }).name === "ResourceNotFoundException";
    if (notFound) {
      throw new DynamoDBSchemaError(
        `DynamoDB table "${tableName}" does not exist. Run: npm run setup:dynamo`,
      );
    }
    throw error;
  }

  if (!isSingleTableKeySchema(keySchema)) {
    throw new DynamoDBSchemaError(wrongSchemaMessage(tableName, keySchema));
  }
}

function toUserItem(user: User): UserItem {
  return {
    pk: pkUser(user.userId),
    sk: skProfile(),
    entityType: "USER",
    ...user,
  };
}

function toOrganizationItem(org: Organization): OrganizationItem {
  return {
    pk: pkOrg(org.organizationId),
    sk: skOrgMetadata(),
    entityType: "ORG",
    ...org,
  };
}

function toImageItem(image: ImageRecord): ImageItem {
  return {
    pk: pkOrg(image.organizationId),
    sk: skImage(image.imageId),
    entityType: "IMAGE",
    ...image,
  };
}

function toJobItem(job: JobRecord): JobItem {
  return {
    pk: pkOrg(job.organizationId),
    sk: skJob(job.jobId),
    entityType: "JOB",
    ...job,
  };
}

function toJobImageItem(image: JobImageRecord): JobImageItem {
  return {
    pk: pkOrg(image.organizationId),
    sk: skJobImage(image.jobId, image.imageId),
    entityType: "JOB_IMAGE",
    ...image,
  };
}

function fromUserItem(item: UserItem): User {
  const { pk: _pk, sk: _sk, entityType: _et, ...user } = item;
  return user;
}

function fromOrganizationItem(item: OrganizationItem): Organization {
  const { pk: _pk, sk: _sk, entityType: _et, ...org } = item;
  return org;
}

function fromImageItem(item: ImageItem): ImageRecord {
  const { pk: _pk, sk: _sk, entityType: _et, ...image } = item;
  return image;
}

function fromJobItem(item: JobItem): JobRecord {
  const { pk: _pk, sk: _sk, entityType: _et, ...job } = item;
  return job;
}

function fromJobImageItem(item: JobImageItem): JobImageRecord {
  const { pk: _pk, sk: _sk, entityType: _et, ...image } = item;
  return image;
}

export class DynamoDBStore {
  async init(options?: { recreateTable?: boolean }): Promise<void> {
    if (config.dynamodbAutoCreate) {
      await ensureSingleTable({ recreate: options?.recreateTable });
    } else {
      await assertSingleTableSchema();
    }
    await this.seedDefaults();
  }

  /** Idempotent: writes hardcoded demo user + org (no login yet). */
  async seedDefaults(): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.putUser(createDemoUser(createdAt));
    await this.putOrganization(createDemoOrganization(createdAt));
  }

  async putUser(user: User): Promise<void> {
    await dynamoDocClient.send(
      new PutCommand({
        TableName: config.aws.dynamoTable,
        Item: toUserItem(user),
      }),
    );
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkUser(userId), sk: skProfile() },
      }),
    );
    if (!result.Item) return null;
    return fromUserItem(result.Item as UserItem);
  }

  async putOrganization(org: Organization): Promise<void> {
    await dynamoDocClient.send(
      new PutCommand({
        TableName: config.aws.dynamoTable,
        Item: toOrganizationItem(org),
      }),
    );
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkOrg(organizationId), sk: skOrgMetadata() },
      }),
    );
    if (!result.Item) return null;
    return fromOrganizationItem(result.Item as OrganizationItem);
  }

  async putImage(image: ImageRecord): Promise<void> {
    await dynamoDocClient.send(
      new PutCommand({
        TableName: config.aws.dynamoTable,
        Item: toImageItem(image),
      }),
    );
  }

  async getImage(
    organizationId: string,
    imageId: number,
  ): Promise<ImageRecord | null> {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkOrg(organizationId), sk: skImage(imageId) },
      }),
    );
    if (!result.Item) return null;
    return fromImageItem(result.Item as ImageItem);
  }

  async putJob(job: JobRecord): Promise<void> {
    await dynamoDocClient.send(
      new PutCommand({
        TableName: config.aws.dynamoTable,
        Item: toJobItem(job),
      }),
    );
  }

  async getJob(
    organizationId: string,
    jobId: string,
  ): Promise<JobRecord | null> {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkOrg(organizationId), sk: skJob(jobId) },
      }),
    );
    if (!result.Item) return null;
    return fromJobItem(result.Item as JobItem);
  }

  async putJobImage(image: JobImageRecord): Promise<void> {
    await dynamoDocClient.send(
      new PutCommand({
        TableName: config.aws.dynamoTable,
        Item: toJobImageItem(image),
      }),
    );
  }

  async getJobImage(
    organizationId: string,
    jobId: string,
    imageId: number,
  ): Promise<JobImageRecord | null> {
    const result = await dynamoDocClient.send(
      new GetCommand({
        TableName: config.aws.dynamoTable,
        Key: {
          pk: pkOrg(organizationId),
          sk: skJobImage(jobId, imageId),
        },
      }),
    );
    if (!result.Item) return null;
    return fromJobImageItem(result.Item as JobImageItem);
  }

  async listJobImages(
    organizationId: string,
    jobId: string,
  ): Promise<JobImageRecord[]> {
    const result = await dynamoDocClient.send(
      new QueryCommand({
        TableName: config.aws.dynamoTable,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": pkOrg(organizationId),
          ":prefix": jobImageSkPrefix(jobId),
        },
      }),
    );

    return (result.Items ?? []).map((item) =>
      fromJobImageItem(item as JobImageItem),
    );
  }

  async updateJobImageStatus(
    organizationId: string,
    jobId: string,
    imageId: number,
    update: {
      status: JobImageRecord["status"];
      originalS3Key?: string;
      processedS3Key?: string;
      failedReason?: string;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const expressions = ["#status = :status", "updatedAt = :updatedAt"];
    const names: Record<string, string> = { "#status": "status" };
    const values: Record<string, string> = {
      ":status": update.status,
      ":updatedAt": now,
    };

    if (update.originalS3Key !== undefined) {
      expressions.push("originalS3Key = :originalS3Key");
      values[":originalS3Key"] = update.originalS3Key;
    }
    if (update.processedS3Key !== undefined) {
      expressions.push("processedS3Key = :processedS3Key");
      values[":processedS3Key"] = update.processedS3Key;
    }
    if (update.failedReason !== undefined) {
      expressions.push("failedReason = :failedReason");
      values[":failedReason"] = update.failedReason;
    }

    await dynamoDocClient.send(
      new UpdateCommand({
        TableName: config.aws.dynamoTable,
        Key: {
          pk: pkOrg(organizationId),
          sk: skJobImage(jobId, imageId),
        },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async incrementJobCounters(
    organizationId: string,
    jobId: string,
    delta: {
      completedCount?: number;
      failedCount?: number;
      processingCount?: number;
    },
  ): Promise<void> {
    const parts: string[] = ["updatedAt = :updatedAt"];
    const values: Record<string, number | string> = {
      ":updatedAt": new Date().toISOString(),
    };

    if (delta.completedCount) {
      parts.push("completedCount = completedCount + :completedDelta");
      values[":completedDelta"] = delta.completedCount;
    }
    if (delta.failedCount) {
      parts.push("failedCount = failedCount + :failedDelta");
      values[":failedDelta"] = delta.failedCount;
    }
    if (delta.processingCount) {
      parts.push("processingCount = processingCount + :processingDelta");
      values[":processingDelta"] = delta.processingCount;
    }

    await dynamoDocClient.send(
      new UpdateCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkOrg(organizationId), sk: skJob(jobId) },
        UpdateExpression: `SET ${parts.join(", ")}`,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async updateJobStatus(
    organizationId: string,
    jobId: string,
    status: JobRecord["status"],
  ): Promise<void> {
    await dynamoDocClient.send(
      new UpdateCommand({
        TableName: config.aws.dynamoTable,
        Key: { pk: pkOrg(organizationId), sk: skJob(jobId) },
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": new Date().toISOString(),
        },
      }),
    );
  }

  /** Validates org exists; defaults to hardcoded demo org when omitted. */
  async requireOrganization(organizationId?: string): Promise<Organization> {
    const id = organizationId ?? DEMO_ORG_ID;
    const org = await this.getOrganization(id);
    if (!org) {
      throw new Error(`Organization not found: ${id}`);
    }
    return org;
  }
}

export const db = new DynamoDBStore();
