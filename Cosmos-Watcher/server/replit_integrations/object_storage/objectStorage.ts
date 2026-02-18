/**
 * Object Storage Service - Stubbed for non-Replit deployment.
 *
 * The demo videos are served from /attached_assets/ via Express static middleware.
 * Object storage features (upload, custom video URLs) are only available on Replit.
 * This stub prevents import-time crashes while maintaining the same API surface.
 */

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Stub client — not used outside Replit
export const objectStorageClient = null as any;

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    console.warn("[ObjectStorage] Not available outside Replit — demo videos served from /attached_assets/");
    return [];
  }

  getPrivateObjectDir(): string {
    throw new Error("Object storage is not available outside Replit. Demo videos are served from /attached_assets/.");
  }

  async searchPublicObject(_filePath: string): Promise<null> {
    return null;
  }

  async downloadObject(_file: any, res: any, _cacheTtlSec: number = 3600): Promise<void> {
    res.status(503).json({ error: "Object storage not available outside Replit" });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    throw new Error("File uploads are not available outside Replit.");
  }

  async getPublicObjectUploadURL(): Promise<{ uploadUrl: string; publicUrl: string; objectPath: string }> {
    throw new Error("File uploads are not available outside Replit.");
  }

  async getObjectEntityFile(_objectPath: string): Promise<any> {
    throw new ObjectNotFoundError();
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: any
  ): Promise<{ normalizedPath: string; publicUrl: string | null }> {
    return { normalizedPath: rawPath, publicUrl: null };
  }

  async canAccessObjectEntity(_params: any): Promise<boolean> {
    return false;
  }

  async deleteObjectEntity(_objectPath: string): Promise<void> {
    throw new Error("Object storage is not available outside Replit.");
  }
}
