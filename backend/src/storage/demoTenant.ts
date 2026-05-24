import type { Organization, User } from "../models/entities.js";

/** Hardcoded demo tenant — persisted in DynamoDB via seedDefaults(). */
export const DEMO_USER_ID = "user-demo-001";
export const DEMO_ORG_ID = "org-demo-001";

export function createDemoUser(createdAt: string): User {
  return {
    userId: DEMO_USER_ID,
    email: "demo@aperture.local",
    name: "Demo User",
    createdAt,
  };
}

export function createDemoOrganization(createdAt: string): Organization {
  return {
    organizationId: DEMO_ORG_ID,
    ownerId: DEMO_USER_ID,
    memberIds: [DEMO_USER_ID],
    plan: "starter",
  };
}
