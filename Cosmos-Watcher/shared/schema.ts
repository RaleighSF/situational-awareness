import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const sourceSettingsSchema = z.object({
  boundingBox: z.union([boundingBoxSchema, z.null()]).optional(),
  sceneContext: z.string().max(1000).optional(),
});

export type SourceSettings = z.infer<typeof sourceSettingsSchema>;

export const videoSources = pgTable("video_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  isActive: boolean("is_active").default(true),
  settings: jsonb("settings").$type<SourceSettings | null>(),
});

export const videoSourcesRelations = relations(videoSources, ({ many }) => ({
  prompts: many(prompts),
}));

export const prompts = pgTable("prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoSourceId: varchar("video_source_id"),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  boundingBox: jsonb("bounding_box").$type<BoundingBox | null>(),
  frequencySeconds: integer("frequency_seconds").notNull().default(60),
  isActive: boolean("is_active").default(true),
});

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  videoSource: one(videoSources, {
    fields: [prompts.videoSourceId],
    references: [videoSources.id],
  }),
  alerts: many(alerts),
}));

export const batchMetaSchema = z.object({
  mode: z.enum(["single", "batch"]),
  frameCount: z.number().optional(),
  intervalSeconds: z.number().optional(),
  durationSeconds: z.number().optional(),
  observations: z.array(z.object({
    t: z.number(),
    text: z.string(),
  })).optional(),
  synthesis: z.string().optional(),
});

export type BatchMeta = z.infer<typeof batchMetaSchema>;

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptId: varchar("prompt_id").references(() => prompts.id),
  timestamp: timestamp("timestamp").defaultNow(),
  frameData: text("frame_data"),
  analysisResult: text("analysis_result").notNull(),
  confidence: text("confidence"),
  isRead: boolean("is_read").default(false),
  batchMeta: jsonb("batch_meta").$type<BatchMeta | null>(),
});

export const alertsRelations = relations(alerts, ({ one }) => ({
  prompt: one(prompts, {
    fields: [alerts.promptId],
    references: [prompts.id],
  }),
}));

export const insertVideoSourceSchema = createInsertSchema(videoSources, {
  settings: z.union([sourceSettingsSchema, z.null()]).optional(),
}).omit({ id: true });

export const insertPromptSchema = createInsertSchema(prompts, {
  boundingBox: z.union([boundingBoxSchema, z.null()]).optional(),
}).omit({ id: true });

export const insertAlertSchema = createInsertSchema(alerts, {
  batchMeta: z.union([batchMetaSchema, z.null()]).optional(),
}).omit({ id: true, timestamp: true });

export type InsertVideoSource = z.infer<typeof insertVideoSourceSchema>;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type VideoSource = typeof videoSources.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Alert = typeof alerts.$inferSelect;

export const batchAlertRequestSchema = z.object({
  frames: z.array(z.string()).min(2).max(12),
  promptId: z.string(),
  intervalSeconds: z.number().min(1).max(30).default(2),
  durationSeconds: z.number().min(1).max(60).optional(),
  sceneContext: z.string().max(1000).optional(),
});

export type BatchAlertRequest = z.infer<typeof batchAlertRequestSchema>;

export const sceneAgentConfigSchema = z.object({
  durationSeconds: z.number().min(10).max(120).default(20),
  intervalSeconds: z.number().min(2).max(30).default(4),
  boundingBox: z.union([boundingBoxSchema, z.null()]).optional(),
});

export const sceneAgentRequestSchema = z.object({
  frames: z.array(z.string()).min(1, "At least one frame is required"),
  intervalSeconds: z.number().min(2).max(30).default(4),
  durationSeconds: z.number().min(10).max(120).default(20),
  sceneContext: z.string().max(1000).optional(),
});

export const frameObservationSchema = z.object({
  t: z.number(),
  text: z.string(),
  confidence: z.string().optional(),
});

export const sceneAgentTimelineEventSchema = z.object({
  t: z.number(),
  event: z.string(),
});

export const sceneAgentSynthesisSchema = z.object({
  summary: z.string(),
  timeline: z.array(sceneAgentTimelineEventSchema).default([]),
  changes: z.array(z.string()).default([]),
  persistent: z.array(z.string()).default([]),
  anomalies: z.array(z.string()).default([]),
  escalation: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export const sceneAgentResultSchema = z.object({
  observations: z.array(frameObservationSchema),
  synthesis: sceneAgentSynthesisSchema.nullable(),
  rawText: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  frameCount: z.number(),
  intervalSeconds: z.number().optional(), // Interval between frames in seconds
  durationSeconds: z.number().optional(), // Total video sampling duration in seconds
});

export type SceneAgentConfig = z.infer<typeof sceneAgentConfigSchema>;
export type FrameObservation = z.infer<typeof frameObservationSchema>;
export type SceneAgentTimelineEvent = z.infer<typeof sceneAgentTimelineEventSchema>;
export type SceneAgentSynthesis = z.infer<typeof sceneAgentSynthesisSchema>;
export type SceneAgentResult = z.infer<typeof sceneAgentResultSchema>;
