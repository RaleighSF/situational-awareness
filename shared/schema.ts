import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const videoSources = pgTable("video_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  isActive: boolean("is_active").default(true),
});

export const videoSourcesRelations = relations(videoSources, ({ many }) => ({
  prompts: many(prompts),
}));

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type BoundingBox = z.infer<typeof boundingBoxSchema>;

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

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptId: varchar("prompt_id").references(() => prompts.id),
  timestamp: timestamp("timestamp").defaultNow(),
  frameData: text("frame_data"),
  analysisResult: text("analysis_result").notNull(),
  confidence: text("confidence"),
  isRead: boolean("is_read").default(false),
});

export const alertsRelations = relations(alerts, ({ one }) => ({
  prompt: one(prompts, {
    fields: [alerts.promptId],
    references: [prompts.id],
  }),
}));

export const insertVideoSourceSchema = createInsertSchema(videoSources).omit({ id: true });

export const insertPromptSchema = createInsertSchema(prompts, {
  boundingBox: z.union([boundingBoxSchema, z.null()]).optional(),
}).omit({ id: true });

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, timestamp: true });

export type InsertVideoSource = z.infer<typeof insertVideoSourceSchema>;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type VideoSource = typeof videoSources.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Alert = typeof alerts.$inferSelect;

export const sceneAgentConfigSchema = z.object({
  durationSeconds: z.number().min(10).max(120).default(20),
  intervalSeconds: z.number().min(3).max(30).default(4),
  boundingBox: z.union([boundingBoxSchema, z.null()]).optional(),
});

export const sceneAgentRequestSchema = z.object({
  frames: z.array(z.string()).min(1, "At least one frame is required"),
  intervalSeconds: z.number().min(3).max(30).default(4),
  durationSeconds: z.number().min(10).max(120).default(20),
});

export const frameObservationSchema = z.object({
  t: z.number(),
  text: z.string(),
  confidence: z.string().optional(),
});

export const sceneAgentEventSchema = z.object({
  t: z.number(),
  description: z.string(),
  type: z.string().optional(),
});

export const sceneAgentSynthesisSchema = z.object({
  summary: z.string(),
  changes: z.array(z.string()),
  persistent: z.array(z.string()),
  events: z.array(sceneAgentEventSchema),
  anomalies: z.array(z.string()),
  escalations: z.array(z.string()),
  confidence: z.string(),
});

export const sceneAgentResultSchema = z.object({
  observations: z.array(frameObservationSchema),
  synthesis: sceneAgentSynthesisSchema.nullable(),
  rawText: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  frameCount: z.number(),
});

export type SceneAgentConfig = z.infer<typeof sceneAgentConfigSchema>;
export type FrameObservation = z.infer<typeof frameObservationSchema>;
export type SceneAgentEvent = z.infer<typeof sceneAgentEventSchema>;
export type SceneAgentSynthesis = z.infer<typeof sceneAgentSynthesisSchema>;
export type SceneAgentResult = z.infer<typeof sceneAgentResultSchema>;
