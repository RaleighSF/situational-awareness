/**
 * Object ACL - Stubbed for non-Replit deployment.
 */

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

export async function setObjectAclPolicy(
  _objectFile: any,
  _aclPolicy: ObjectAclPolicy,
): Promise<void> {
  throw new Error("Object ACL is not available outside Replit.");
}

export async function getObjectAclPolicy(
  _objectFile: any,
): Promise<ObjectAclPolicy | null> {
  return null;
}

export async function canAccessObject(_params: {
  userId?: string;
  objectFile: any;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  return false;
}
