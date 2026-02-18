import { objectStorageClient } from '../server/replit_integrations/object_storage/objectStorage';
import fs from 'fs';

async function main() {
  const filePath = 'attached_assets/parking-lot.mov';
  const content = fs.readFileSync(filePath);
  
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID not set');
  }
  
  const objectName = 'public/videos/parking-lot.mov';
  console.log(`Uploading parking-lot.mov to ${bucketId}/${objectName} (${(content.length / 1024 / 1024).toFixed(1)}MB)...`);
  
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectName);
  
  await file.save(content, {
    contentType: 'video/quicktime',
    resumable: true,
  });
  
  console.log('Upload complete!');
  console.log('Public URL: /objects/public/videos/parking-lot.mov');
}

main().catch(console.error);
