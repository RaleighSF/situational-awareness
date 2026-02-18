import {
  type VideoSource,
  type InsertVideoSource,
  type Prompt,
  type InsertPrompt,
  type Alert,
  type InsertAlert,
  type SourceSettings,
  videoSources,
  prompts,
  alerts,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, inArray } from "drizzle-orm";
import fs from "fs";
import path from "path";

// Canonical demo dataset - this defines all demo data that will be restored on each production deployment
const DEMO_VIDEO_SOURCES = [
  { 
    name: "Loading Dock", 
    url: "/attached_assets/4473271-hd_1920_1080_30fps_1768617999296.mp4",
    settings: { sceneContext: "This is our loading dock and I'm primarily concerned with worker productivity vs. just sitting around and socializing." }
  },
  { 
    name: "Product Picking", 
    url: "/attached_assets/product-picking.mp4",
    settings: null
  },
  { 
    name: "Engine Assembly", 
    url: "/attached_assets/engine-assembly.mp4",
    settings: { sceneContext: "Motorcycle Engine assembly. The worker must never strike the engine with their hand to seat parts together." }
  },
  { 
    name: "Parking Lot", 
    url: "/attached_assets/parking-lot.mp4",
    settings: null
  },
  {
    name: "Ring Camera", 
    url: "/attached_assets/ring-camera.mp4",
    settings: null
  },
  { 
    name: "Plant Fire", 
    url: "/attached_assets/plant-fire.mp4",
    settings: { sceneContext: "Industrial manufacturing plant with active machinery. Fire safety is critical priority.\nTOOLS: Robotic dog with fire suppression capabilities available for deployment" }
  },
  { 
    name: "DoC Video", 
    url: "/attached_assets/doc-video.mp4",
    settings: null
  },
];

// Demo prompts linked by video source name
const DEMO_PROMPTS = [
  {
    videoSourceName: "Loading Dock",
    name: "Red Packages",
    prompt: "Detect the presence of Red Packages in this scene.",
    boundingBox: { x: 24.206880431780032, y: 42.79319267891884, width: 26.382779796434416, height: 23.69340611601156 },
    frequencySeconds: 10
  },
  {
    videoSourceName: "Product Picking",
    name: "Safety Gear Analyzer",
    prompt: "Detect the absence of required safety gear. All workers must have on safety goggles and gloves.",
    boundingBox: null,
    frequencySeconds: 10
  },
  {
    videoSourceName: "Plant Fire",
    name: "Fire Hazard Monitor",
    prompt: "Detect fire, smoke, flames, or any fire hazards. Alert immediately if fire is detected and recommend appropriate response actions.",
    boundingBox: null,
    frequencySeconds: 10
  }
];

// Reset database to canonical demo state - used in production to sync with dev
export async function resetToDemo(): Promise<void> {
  console.log("[Reset] Resetting database to demo state...");
  
  // Clear all existing data
  await db.delete(alerts);
  console.log("[Reset] Cleared alerts");
  await db.delete(prompts);
  console.log("[Reset] Cleared prompts");
  await db.delete(videoSources);
  console.log("[Reset] Cleared video sources");
  
  // Insert canonical demo video sources
  const sourceIdMap = new Map<string, string>();
  for (const demo of DEMO_VIDEO_SOURCES) {
    const [inserted] = await db.insert(videoSources).values({
      name: demo.name,
      url: demo.url,
      isActive: true,
      settings: demo.settings,
    }).returning();
    sourceIdMap.set(demo.name, inserted.id);
    console.log(`[Reset] Added video source: ${demo.name}`);
  }
  
  // Insert canonical demo prompts
  for (const demoPrompt of DEMO_PROMPTS) {
    const sourceId = sourceIdMap.get(demoPrompt.videoSourceName);
    if (sourceId) {
      await db.insert(prompts).values({
        videoSourceId: sourceId,
        name: demoPrompt.name,
        prompt: demoPrompt.prompt,
        boundingBox: demoPrompt.boundingBox,
        frequencySeconds: demoPrompt.frequencySeconds,
        isActive: true,
      });
      console.log(`[Reset] Added prompt: ${demoPrompt.name}`);
    }
  }
  
  console.log("[Reset] Database reset complete - ready with demo data");
}

// Development seed - adds missing sources without clearing existing data
export async function seedDemoVideoSources(): Promise<void> {
  console.log("[Seed] Syncing demo video sources...");
  const existing = await db.select().from(videoSources);
  const existingByName = new Map(existing.map(s => [s.name, s]));
  const demoNames = new Set(DEMO_VIDEO_SOURCES.map(d => d.name));
  
  // Remove sources not in demo list
  for (const source of existing) {
    if (!demoNames.has(source.name)) {
      console.log(`[Seed] Removing stale source: ${source.name}`);
      await db.delete(alerts).where(inArray(alerts.promptId, 
        db.select({ id: prompts.id }).from(prompts).where(eq(prompts.videoSourceId, source.id))
      ));
      await db.delete(prompts).where(eq(prompts.videoSourceId, source.id));
      await db.delete(videoSources).where(eq(videoSources.id, source.id));
    }
  }
  
  // Add or update demo sources
  for (const demo of DEMO_VIDEO_SOURCES) {
    const existingSource = existingByName.get(demo.name);
    if (existingSource) {
      if (existingSource.url !== demo.url) {
        console.log(`[Seed] Updating URL for: ${demo.name}`);
        await db.update(videoSources)
          .set({ url: demo.url })
          .where(eq(videoSources.id, existingSource.id));
      }
    } else {
      console.log(`[Seed] Adding missing video source: ${demo.name}`);
      await db.insert(videoSources).values({
        name: demo.name,
        url: demo.url,
        isActive: true,
        settings: demo.settings,
      });
    }
  }
  console.log("[Seed] Demo video sources sync complete");
}

// Demo snapshot file path - committed to repo for production deployment
const DEMO_SNAPSHOT_PATH = path.join(process.cwd(), "demo-snapshot.json");

// Export current database state to a snapshot file for production deployment
// Note: Alerts are NOT exported - production generates its own and they are preserved
export async function exportDemoSnapshot(): Promise<{ videoSources: number; prompts: number }> {
  console.log("[Snapshot] Exporting demo data (excluding alerts)...");
  
  const allVideoSources = await db.select().from(videoSources);
  const allPrompts = await db.select().from(prompts);
  
  const snapshot = {
    exportedAt: new Date().toISOString(),
    videoSources: allVideoSources,
    prompts: allPrompts,
  };
  
  fs.writeFileSync(DEMO_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`[Snapshot] Exported: ${allVideoSources.length} sources, ${allPrompts.length} prompts`);
  
  return {
    videoSources: allVideoSources.length,
    prompts: allPrompts.length,
  };
}

// Import demo snapshot into database (used in production)
// If production already has data, only updates video URLs (preserves alerts and curated data)
// If production is empty, does a full import
export async function importDemoSnapshot(): Promise<boolean> {
  if (!fs.existsSync(DEMO_SNAPSHOT_PATH)) {
    console.log("[Snapshot] No snapshot file found, skipping import");
    return false;
  }
  
  const snapshotData = JSON.parse(fs.readFileSync(DEMO_SNAPSHOT_PATH, "utf-8"));
  
  // Check if production already has data
  const existingSources = await db.select().from(videoSources);
  
  if (existingSources.length > 0) {
    // Production has existing data - only update video URLs to preserve curated alerts
    console.log("[Snapshot] Production data detected - preserving alerts, only updating video URLs...");
    
    for (const snapshotSource of snapshotData.videoSources) {
      const existing = existingSources.find(s => s.name === snapshotSource.name);
      if (existing && existing.url !== snapshotSource.url) {
        await db.update(videoSources)
          .set({ url: snapshotSource.url })
          .where(eq(videoSources.id, existing.id));
        console.log(`[Snapshot] Updated URL for: ${snapshotSource.name}`);
      } else if (!existing) {
        await db.insert(videoSources).values({
          name: snapshotSource.name,
          url: snapshotSource.url,
          isActive: snapshotSource.isActive,
          settings: snapshotSource.settings,
        });
        console.log(`[Snapshot] Added new source: ${snapshotSource.name}`);
      }
    }
    
    console.log("[Snapshot] URL update complete - existing alerts and data preserved");
    return true;
  }
  
  // Production is empty - do full import
  console.log("[Snapshot] Empty database - performing full import...");
  
  // Import video sources
  const sourceIdMap = new Map<string, string>();
  for (const source of snapshotData.videoSources) {
    const [inserted] = await db.insert(videoSources).values({
      name: source.name,
      url: source.url,
      isActive: source.isActive,
      settings: source.settings,
    }).returning();
    sourceIdMap.set(source.id, inserted.id);
    console.log(`[Snapshot] Imported source: ${source.name}`);
  }
  
  // Import prompts with updated source IDs
  for (const prompt of snapshotData.prompts) {
    const newSourceId = sourceIdMap.get(prompt.videoSourceId);
    if (newSourceId) {
      await db.insert(prompts).values({
        videoSourceId: newSourceId,
        name: prompt.name,
        prompt: prompt.prompt,
        boundingBox: prompt.boundingBox,
        frequencySeconds: prompt.frequencySeconds,
        isActive: prompt.isActive,
      });
      console.log(`[Snapshot] Imported prompt: ${prompt.name}`);
    }
  }
  
  console.log(`[Snapshot] Import complete: ${snapshotData.videoSources.length} sources, ${snapshotData.prompts.length} prompts`);
  return true;
}

export interface IStorage {
  getVideoSources(): Promise<VideoSource[]>;
  getVideoSource(id: string): Promise<VideoSource | undefined>;
  createVideoSource(source: InsertVideoSource): Promise<VideoSource>;
  updateVideoSource(id: string, data: Partial<InsertVideoSource>): Promise<VideoSource | undefined>;
  updateVideoSourceSettings(id: string, settings: SourceSettings): Promise<VideoSource | undefined>;
  deleteVideoSource(id: string): Promise<void>;

  getPrompts(): Promise<Prompt[]>;
  getPromptsByVideoSource(videoSourceId: string): Promise<Prompt[]>;
  deletePromptsByVideoSource(videoSourceId: string): Promise<void>;
  getPrompt(id: string): Promise<Prompt | undefined>;
  createPrompt(prompt: InsertPrompt): Promise<Prompt>;
  updatePrompt(id: string, data: Partial<InsertPrompt>): Promise<Prompt | undefined>;
  deletePrompt(id: string): Promise<void>;

  getAlerts(): Promise<Alert[]>;
  getAlertsByPrompt(promptId: string): Promise<Alert[]>;
  getAlert(id: string): Promise<Alert | undefined>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  updateAlert(id: string, data: Partial<InsertAlert>): Promise<Alert | undefined>;
  deleteAlert(id: string): Promise<void>;
  deleteAllAlerts(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getVideoSources(): Promise<VideoSource[]> {
    return db.select().from(videoSources);
  }

  async getVideoSource(id: string): Promise<VideoSource | undefined> {
    const [source] = await db.select().from(videoSources).where(eq(videoSources.id, id));
    return source || undefined;
  }

  async createVideoSource(source: InsertVideoSource): Promise<VideoSource> {
    const [created] = await db.insert(videoSources).values(source).returning();
    return created;
  }

  async updateVideoSource(id: string, data: Partial<InsertVideoSource>): Promise<VideoSource | undefined> {
    const [updated] = await db.update(videoSources).set(data).where(eq(videoSources.id, id)).returning();
    return updated || undefined;
  }

  async updateVideoSourceSettings(id: string, settings: SourceSettings): Promise<VideoSource | undefined> {
    const [updated] = await db.update(videoSources).set({ settings }).where(eq(videoSources.id, id)).returning();
    return updated || undefined;
  }

  async deleteVideoSource(id: string): Promise<void> {
    await db.delete(videoSources).where(eq(videoSources.id, id));
  }

  async getPrompts(): Promise<Prompt[]> {
    return db.select().from(prompts);
  }

  async getPromptsByVideoSource(videoSourceId: string): Promise<Prompt[]> {
    return db.select().from(prompts).where(eq(prompts.videoSourceId, videoSourceId));
  }

  async deletePromptsByVideoSource(videoSourceId: string): Promise<void> {
    const sourcePrompts = await this.getPromptsByVideoSource(videoSourceId);
    for (const prompt of sourcePrompts) {
      await db.delete(alerts).where(eq(alerts.promptId, prompt.id));
    }
    await db.delete(prompts).where(eq(prompts.videoSourceId, videoSourceId));
  }

  async getPrompt(id: string): Promise<Prompt | undefined> {
    const [prompt] = await db.select().from(prompts).where(eq(prompts.id, id));
    return prompt || undefined;
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const [created] = await db.insert(prompts).values(prompt).returning();
    return created;
  }

  async updatePrompt(id: string, data: Partial<InsertPrompt>): Promise<Prompt | undefined> {
    const [updated] = await db.update(prompts).set(data).where(eq(prompts.id, id)).returning();
    return updated || undefined;
  }

  async deletePrompt(id: string): Promise<void> {
    await db.delete(alerts).where(eq(alerts.promptId, id));
    await db.delete(prompts).where(eq(prompts.id, id));
  }

  async getAlerts(): Promise<Alert[]> {
    return db.select().from(alerts).orderBy(desc(alerts.timestamp));
  }

  async getAlertsByPrompt(promptId: string): Promise<Alert[]> {
    return db.select().from(alerts).where(eq(alerts.promptId, promptId)).orderBy(desc(alerts.timestamp));
  }

  async getAlertsByVideoSource(videoSourceId: string): Promise<Alert[]> {
    const sourcePrompts = await this.getPromptsByVideoSource(videoSourceId);
    const promptIds = sourcePrompts.map(p => p.id);
    if (promptIds.length === 0) return [];
    return db.select().from(alerts).where(inArray(alerts.promptId, promptIds)).orderBy(desc(alerts.timestamp));
  }

  async getAlert(id: string): Promise<Alert | undefined> {
    const [alert] = await db.select().from(alerts).where(eq(alerts.id, id));
    return alert || undefined;
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [created] = await db.insert(alerts).values(alert).returning();
    return created;
  }

  async updateAlert(id: string, data: Partial<InsertAlert>): Promise<Alert | undefined> {
    const [updated] = await db.update(alerts).set(data).where(eq(alerts.id, id)).returning();
    return updated || undefined;
  }

  async deleteAlert(id: string): Promise<void> {
    await db.delete(alerts).where(eq(alerts.id, id));
  }

  async deleteAllAlerts(): Promise<void> {
    await db.delete(alerts);
  }
}

export const storage = new DatabaseStorage();
