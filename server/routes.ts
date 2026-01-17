import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPromptSchema, insertAlertSchema, sceneAgentRequestSchema, sceneAgentSynthesisSchema, sourceSettingsSchema } from "@shared/schema";
import type { BoundingBox, FrameObservation, SceneAgentSynthesis, SceneAgentResult } from "@shared/schema";
import { fromZodError } from "zod-validation-error";

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT || "https://cosmos.agentdemos.com";

interface CosmosROI {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boundingBoxToROI(boundingBox: BoundingBox | null): CosmosROI | undefined {
  if (!boundingBox) return undefined;
  return {
    x: boundingBox.x / 100,
    y: boundingBox.y / 100,
    w: boundingBox.width / 100,
    h: boundingBox.height / 100,
  };
}

async function analyzeWithCosmos(
  frameData: string,
  prompt: string,
  boundingBox: BoundingBox | null = null
): Promise<{ detected: boolean; analysis: string; confidence: string }> {
  if (!frameData || frameData.length < 100) {
    console.log("[Cosmos] Invalid frame data - too short or empty");
    return {
      detected: false,
      analysis: "Invalid frame captured - video may not be loaded",
      confidence: "LOW",
    };
  }

  const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
  const base64Data = dataUrlMatch 
    ? frameData.slice(dataUrlMatch[0].length)
    : frameData;
  
  if (!dataUrlMatch) {
    console.log(`[Cosmos] Frame data doesn't have expected prefix. First 100 chars: ${frameData.substring(0, 100)}`);
  }

  const fullPrompt = `You are a situational awareness AI analyzing security camera footage. Analyze this image and determine if the following condition is present:

"${prompt}"

Answer in this exact format:
DETECTED: [YES/NO]
CONFIDENCE: [HIGH/MEDIUM/LOW]
ANALYSIS: [Your detailed analysis of what you observe]

Be concise but thorough. If you detect the specified condition, explain exactly what you see that matches it. If not, explain what you see instead.`;

  const roi = boundingBoxToROI(boundingBox);

  const payload: {
    image_b64: string;
    prompt: string;
    max_new_tokens: number;
    roi?: CosmosROI;
  } = {
    image_b64: base64Data,
    prompt: fullPrompt,
    max_new_tokens: 256,
  };

  if (roi) {
    payload.roi = roi;
  }

  try {
    const response = await fetch(`${COSMOS_ENDPOINT}/infer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Cosmos API error:", errorText);
      throw new Error(`Cosmos API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.text || "";

    const detectedMatch = content.match(/DETECTED:\s*(YES|NO)/i);
    const confidenceMatch = content.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
    const analysisMatch = content.match(/ANALYSIS:\s*([\s\S]+)/i);

    const detected = detectedMatch?.[1]?.toUpperCase() === "YES";
    const confidence = confidenceMatch?.[1] || "MEDIUM";
    const analysis = analysisMatch?.[1]?.trim() || content;

    return { detected, analysis, confidence };
  } catch (error) {
    console.error("Error calling Cosmos API:", error);
    return {
      detected: false,
      analysis: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      confidence: "LOW",
    };
  }
}

async function getBatchSceneObservations(
  frames: string[], 
  intervalSeconds: number, 
  sceneContext?: string
): Promise<FrameObservation[]> {
  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const prompt = `${contextPreamble}You are observing a security camera feed. Describe exactly what you see in this frame in a factual, structured way.

Focus on:
- People: count, positions, activities, direction of movement
- Vehicles/equipment: type, location, motion (entering/exiting/stationary)
- Objects: notable items, packages, tools - position and state
- Actions: what is happening, who is doing what

Note any temporal cues - things entering/exiting frame, people walking toward/away, objects being picked up/set down.

Be detailed and factual. Use bullet points.`;

  const items = frames.map((frameData, index) => {
    const t = index * intervalSeconds;
    const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
    const image_b64 = dataUrlMatch 
      ? frameData.slice(dataUrlMatch[0].length)
      : frameData;
    return { t, image_b64 };
  });

  const payload = {
    prompt,
    max_new_tokens: 160,
    max_image_side: 512,
    items,
  };

  const requestBody = JSON.stringify(payload);
  const requestSizeKB = (requestBody.length / 1024).toFixed(1);
  const targetUrl = `${COSMOS_ENDPOINT}/infer_batch`;
  
  console.log(`[INFER_BATCH] --> ${targetUrl} (${requestSizeKB}KB, ${items.length} frames)`);
  const t0 = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const t1 = Date.now();
    const fetchMs = t1 - t0;
    console.log(`[INFER_BATCH] <-- status=${response.status} in ${fetchMs}ms (TTFB)`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cosmos /infer_batch API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const t2 = Date.now();
    const parseMs = t2 - t1;
    const totalMs = t2 - t0;
    
    const batched = result.batched ?? false;
    const count = result.count ?? 0;
    const results = result.results ?? [];
    
    console.log(`[INFER_BATCH] body parsed: +${parseMs}ms | TOTAL: ${totalMs}ms | batched=${batched}, count=${count}`);

    const observations: FrameObservation[] = results.map((r: { t: number; text: string }) => ({
      t: r.t,
      text: r.text || "No observation generated",
    }));

    return observations;
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error(`[INFER_BATCH] ERROR after ${totalMs}ms:`, error);
    return frames.map((_, index) => ({
      t: index * intervalSeconds,
      text: `Batch observation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    }));
  }
}

async function synthesizeObservations(observations: FrameObservation[], sceneContext?: string): Promise<{ synthesis: SceneAgentSynthesis | null; rawText: string }> {
  const observationsPayload = observations.map(o => ({
    t: o.t,
    text: o.text,
    confidence: o.confidence,
  }));

  const contextPreamble = sceneContext 
    ? `Scene Context from operator: "${sceneContext}"\nUse this context to focus your analysis.\n\n` 
    : "";

  const prompt = `${contextPreamble}Scene Agent Synthesis: Produce an analyst-quality narrative of what unfolded across the window. In summary, explain overall activity and the key takeaway. In events, list 5-8 material moments in time order that capture how the situation evolved (entries/exits, starts/stops, interactions, notable shifts). Use anomalies for unexpected changes or sharp confidence jumps. Use escalations only for conditions that persist/worsen or warrant attention. Output JSON only.

Return JSON ONLY (no markdown, no extra text) using this exact schema:
{
  "summary": "3-4 sentences max. What happened overall + key takeaway + context.",
  "events": [
    { "t": 0, "description": "<= 18 words" }
  ],
  "anomalies": ["<= 14 words each"],
  "escalations": ["<= 16 words each"],
  "confidence": 0.0
}

Quality bar:
- Focus on situational awareness: actions, interactions, transitions, persistence, intent.
- Prefer comparative language over static inventories.
- Include subtle-but-meaningful changes (entries/exits, count changes, starts/stops, proximity shifts, confidence jumps).

Hard limits (must follow):
- summary: 3-4 sentences max, <= 90 words total.
- events: MUST be 5 to 8 items, MATERIAL moments only (not every frame).
  - description: <= 18 words, single sentence.
  - t is an integer seconds offset into the window.
- anomalies: 0 to 6 items, each <= 14 words.
- escalations: 0 to 3 items, each <= 16 words.
- confidence: number between 0 and 1.`;

  const payload = {
    prompt,
    observations: observationsPayload,
    max_new_tokens: 1024,
  };

  const requestBody = JSON.stringify(payload);
  const requestSizeKB = (requestBody.length / 1024).toFixed(1);
  const totalObsChars = observationsPayload.reduce((sum, o) => sum + o.text.length, 0);
  const targetUrl = `${COSMOS_ENDPOINT}/reason`;
  
  console.log(`[REASON] --> ${targetUrl} (${requestSizeKB}KB, ${observationsPayload.length} obs, ${totalObsChars} chars)`);
  const t0 = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const t1 = Date.now();
    const fetchMs = t1 - t0;
    console.log(`[REASON] <-- status=${response.status} in ${fetchMs}ms (TTFB)`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cosmos /reason API error: ${response.status} - ${errorText}`);
    }

    const apiResult = await response.json();
    const t2 = Date.now();
    const parseMs = t2 - t1;
    const totalMs = t2 - t0;
    
    const rawText = apiResult.raw_text || "";
    const responseChars = rawText.length;
    const responseWords = rawText.split(/\s+/).length;
    
    console.log(`[REASON] body parsed: +${parseMs}ms | TOTAL: ${totalMs}ms | ${responseWords} words, ${responseChars} chars`);
    
    if (apiResult.result) {
      const parseResult = sceneAgentSynthesisSchema.safeParse(apiResult.result);
      if (parseResult.success) {
        return { synthesis: parseResult.data, rawText };
      }
      console.error("Failed to validate synthesis result:", parseResult.error);
    }

    if (rawText) {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          
          return {
            synthesis: {
              summary: parsed.summary || "Analysis complete.",
              events: Array.isArray(parsed.events) ? parsed.events.map((e: { t?: number; description?: string; rule_id?: string }) => ({
                t: e.t ?? 0,
                description: e.description ?? "Observation recorded",
                rule_id: e.rule_id,
              })) : [],
              anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
              escalations: Array.isArray(parsed.escalations) ? parsed.escalations : [],
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            },
            rawText,
          };
        } catch {
          console.error("Failed to parse synthesis JSON from raw_text:", rawText);
        }
      }
    }

    return { synthesis: null, rawText };
  } catch (error) {
    console.error("Error synthesizing observations:", error);
    return { 
      synthesis: null, 
      rawText: `Synthesis failed: ${error instanceof Error ? error.message : "Unknown error"}` 
    };
  }
}

const DEFAULT_VIDEO_SOURCES = [
  {
    id: "got-commercial",
    name: "GoT Commercial",
    url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  },
  {
    id: "loading-dock",
    name: "Loading Dock",
    url: "/attached_assets/4473271-hd_1920_1080_30fps_1768617999296.mp4",
  },
];

async function seedVideoSources() {
  const existing = await storage.getVideoSources();
  if (existing.length === 0) {
    console.log("[Seed] Creating default video sources...");
    for (const source of DEFAULT_VIDEO_SOURCES) {
      await storage.createVideoSource({
        name: source.name,
        url: source.url,
        isActive: true,
      });
    }
    console.log("[Seed] Default video sources created");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await seedVideoSources();

  app.get("/api/video-sources", async (_req, res) => {
    try {
      const sources = await storage.getVideoSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching video sources:", error);
      res.status(500).json({ error: "Failed to fetch video sources" });
    }
  });

  app.get("/api/video-sources/:id", async (req, res) => {
    try {
      const source = await storage.getVideoSource(req.params.id);
      if (!source) {
        return res.status(404).json({ error: "Video source not found" });
      }
      res.json(source);
    } catch (error) {
      console.error("Error fetching video source:", error);
      res.status(500).json({ error: "Failed to fetch video source" });
    }
  });

  app.patch("/api/video-sources/:id/settings", async (req, res) => {
    try {
      const parseResult = sourceSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: fromZodError(parseResult.error).message });
      }
      const source = await storage.updateVideoSourceSettings(req.params.id, parseResult.data);
      if (!source) {
        return res.status(404).json({ error: "Video source not found" });
      }
      res.json(source);
    } catch (error) {
      console.error("Error updating video source settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.get("/api/prompts", async (req, res) => {
    try {
      const videoSourceId = req.query.videoSourceId as string | undefined;
      const prompts = videoSourceId 
        ? await storage.getPromptsByVideoSource(videoSourceId)
        : await storage.getPrompts();
      res.json(prompts);
    } catch (error) {
      console.error("Error fetching prompts:", error);
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  app.get("/api/prompts/:id", async (req, res) => {
    try {
      const prompt = await storage.getPrompt(req.params.id);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found" });
      }
      res.json(prompt);
    } catch (error) {
      console.error("Error fetching prompt:", error);
      res.status(500).json({ error: "Failed to fetch prompt" });
    }
  });

  app.post("/api/prompts", async (req, res) => {
    try {
      const data = insertPromptSchema.parse(req.body);
      const prompt = await storage.createPrompt(data);
      res.status(201).json(prompt);
    } catch (error) {
      console.error("Error creating prompt:", error);
      res.status(400).json({ error: "Invalid prompt data" });
    }
  });

  app.patch("/api/prompts/:id", async (req, res) => {
    try {
      const prompt = await storage.updatePrompt(req.params.id, req.body);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found" });
      }
      res.json(prompt);
    } catch (error) {
      console.error("Error updating prompt:", error);
      res.status(400).json({ error: "Failed to update prompt" });
    }
  });

  app.delete("/api/prompts/:id", async (req, res) => {
    try {
      await storage.deletePrompt(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting prompt:", error);
      res.status(500).json({ error: "Failed to delete prompt" });
    }
  });

  app.get("/api/alerts", async (_req, res) => {
    try {
      const alerts = await storage.getAlerts();
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.get("/api/alerts/:id", async (req, res) => {
    try {
      const alert = await storage.getAlert(req.params.id);
      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }
      res.json(alert);
    } catch (error) {
      console.error("Error fetching alert:", error);
      res.status(500).json({ error: "Failed to fetch alert" });
    }
  });

  app.patch("/api/alerts/:id", async (req, res) => {
    try {
      const alert = await storage.updateAlert(req.params.id, req.body);
      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }
      res.json(alert);
    } catch (error) {
      console.error("Error updating alert:", error);
      res.status(400).json({ error: "Failed to update alert" });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    try {
      await storage.deleteAlert(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting alert:", error);
      res.status(500).json({ error: "Failed to delete alert" });
    }
  });

  app.delete("/api/alerts", async (_req, res) => {
    try {
      await storage.deleteAllAlerts();
      res.status(204).send();
    } catch (error) {
      console.error("Error clearing alerts:", error);
      res.status(500).json({ error: "Failed to clear alerts" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { frameData, promptId } = req.body;

      if (!frameData || !promptId) {
        return res.status(400).json({ error: "frameData and promptId are required" });
      }

      const prompt = await storage.getPrompt(promptId);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const result = await analyzeWithCosmos(frameData, prompt.prompt, null);

      let alertCreated = false;
      if (result.detected) {
        await storage.createAlert({
          promptId: promptId,
          frameData: frameData,
          analysisResult: result.analysis,
          confidence: result.confidence,
          isRead: false,
        });
        alertCreated = true;
      }

      res.json({
        detected: result.detected,
        analysis: result.analysis,
        confidence: result.confidence,
        alertCreated,
      });
    } catch (error) {
      console.error("Error analyzing frame:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to analyze frame";
      const isEndpointUnavailable = errorMessage.includes("ENOTFOUND") || 
                                     errorMessage.includes("ETIMEDOUT") ||
                                     errorMessage.includes("503") ||
                                     errorMessage.includes("502");
      res.status(500).json({ 
        error: isEndpointUnavailable 
          ? "Cosmos endpoint temporarily unavailable. DNS may still be propagating." 
          : errorMessage,
        endpointUnavailable: isEndpointUnavailable
      });
    }
  });

  app.get("/api/cosmos/health", async (_req, res) => {
    try {
      const response = await fetch(`${COSMOS_ENDPOINT}/health`);
      if (response.ok) {
        res.json({ status: "healthy", endpoint: COSMOS_ENDPOINT });
      } else {
        res.status(503).json({ status: "unhealthy", endpoint: COSMOS_ENDPOINT });
      }
    } catch (error) {
      res.status(503).json({ 
        status: "unavailable", 
        endpoint: COSMOS_ENDPOINT,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/test/frame", async (_req, res) => {
    res.json({
      frame: null,
      timestamp: Date.now(),
      error: "Video capture required - please wait for video to load"
    });
  });

  app.post("/api/scene-agent/run", async (req, res) => {
    try {
      const parseResult = sceneAgentRequestSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        const errorMessage = fromZodError(parseResult.error).message;
        console.log(`[Scene Agent] Validation failed: ${errorMessage}`);
        return res.status(400).json({ error: errorMessage });
      }
      
      const { frames, intervalSeconds, durationSeconds, sceneContext } = parseResult.data;

      console.log(`[Scene Agent] Starting batch analysis of ${frames.length} frames over ${durationSeconds}s`);
      const startTime = new Date().toISOString();

      const observations = await getBatchSceneObservations(frames, intervalSeconds, sceneContext);
      
      console.log(`[Scene Agent] All ${observations.length} frames analyzed via batch`);

      console.log(`[Scene Agent] Synthesizing observations via /reason`);
      const { synthesis, rawText } = await synthesizeObservations(observations, sceneContext);

      const endTime = new Date().toISOString();

      const result: SceneAgentResult = {
        observations,
        synthesis,
        rawText,
        startTime,
        endTime,
        frameCount: frames.length,
      };

      console.log(`[Scene Agent] Analysis complete`);
      res.json(result);
    } catch (error) {
      console.error("Scene Agent error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Scene Agent analysis failed" 
      });
    }
  });

  app.get("/api/video/proxy", async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }
    
    try {
      const headers: Record<string, string> = {};
      const range = req.headers.range;
      if (range) {
        headers["Range"] = range;
      }
      
      const response = await fetch(videoUrl, { headers });
      
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "bytes");
      
      const contentType = response.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);
      
      const contentLength = response.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      
      const contentRange = response.headers.get("content-range");
      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
        res.status(206);
      }
      
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("[Video Proxy] Error:", error);
      res.status(500).json({ error: "Failed to proxy video" });
    }
  });

  return httpServer;
}
