import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import type { KeySchemaElement } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
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
  Organization,
  OrganizationItem,
  User,
  UserItem,
} from "../models/entities.js";
import {
  pkOrg,
  pkUser,
  skImage,
  skOrgMetadata,
  skProfile,
} from "./keys.js";

export function generateImageId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
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
