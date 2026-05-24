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

export function skJob(jobId: string): string {
  return `JOB#${jobId}`;
}

export function skJobImage(jobId: string, imageId: number): string {
  return `JOB#${jobId}#IMAGE#${imageId}`;
}

export function jobImageSkPrefix(jobId: string): string {
  return `JOB#${jobId}#IMAGE#`;
}
