export function pkUser(userId: string): string {
  return `USER#${userId}`;
}

export function pkOrg(organizationId: string): string {
  return `ORG#${organizationId}`;
}

export function skProfile(): string {
  return "PROFILE";
}

export function skOrgMetadata(): string {
  return "METADATA";
}

export function skImage(imageId: number): string {
  return `IMAGE#${imageId}`;
}
