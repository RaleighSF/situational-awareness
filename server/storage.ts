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

const DEMO_VIDEO_SOURCES = [
  { name: "Loading Dock", url: "/attached_assets/4473271-hd_1920_1080_30fps_1768617999296.mp4" },
  { name: "Product Picking", url: "/attached_assets/product-picking.mp4" },
  { name: "Engine Assembly", url: "/attached_assets/engine-assembly.mp4" },
  { name: "Parking Lot", url: "/attached_assets/parking-lot.mov" },
  { name: "The Newspaper", url: "/attached_assets/newspaper.mp4" },
];

export async function seedDemoVideoSources(): Promise<void> {
  console.log("[Seed] Syncing demo video sources...");
  const existing = await db.select().from(videoSources);
  const existingByName = new Map(existing.map(s => [s.name, s]));
  
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
      });
    }
  }
  console.log("[Seed] Demo video sources sync complete");
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
