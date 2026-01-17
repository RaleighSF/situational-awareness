import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPromptSchema, insertAlertSchema, sceneAgentRequestSchema, sceneAgentSynthesisSchema } from "@shared/schema";
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

async function getSceneObservation(frameData: string, timestampOffset: number, sceneContext?: string): Promise<{ text: string; confidence?: string }> {
  if (!frameData || frameData.length < 100) {
    return { text: "Invalid frame - could not analyze" };
  }

  const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
  const base64Data = dataUrlMatch 
    ? frameData.slice(dataUrlMatch[0].length)
    : frameData;

  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const prompt = `${contextPreamble}You are observing a security camera feed at T+${timestampOffset}s. Describe exactly what you see in this frame in a factual, structured way.

Focus on:
- People: count, positions, activities, direction of movement
- Vehicles/equipment: type, location, motion (entering/exiting/stationary)
- Objects: notable items, packages, tools - position and state
- Environment: lighting conditions, weather if visible
- Actions: what is happening, who is doing what, motion blur indicating movement

IMPORTANT: Note any temporal cues - things that appear to be entering/exiting the frame, people walking toward/away, objects being picked up/set down, doors opening/closing.

Be detailed and factual. Use bullet points.`;

  const payload = {
    image_b64: base64Data,
    prompt: prompt,
    max_new_tokens: 192,
  };

  try {
    const response = await fetch(`${COSMOS_ENDPOINT}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Cosmos API error: ${response.status}`);
    }

    const result = await response.json();
    return { text: result.text || "No observation generated" };
  } catch (error) {
    console.error("Error getting scene observation:", error);
    return { text: `Observation failed: ${error instanceof Error ? error.message : "Unknown error"}` };
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

  const prompt = `${contextPreamble}Role: Scene Intelligence Analyst reviewing time-ordered security camera footage.

CRITICAL: Return ONLY valid JSON. Keep ALL text fields SHORT and concise.

{
  "summary": "2-3 SHORT sentences only. What happened and key takeaway.",
  "changes": ["3-5 transition descriptions using entered/exited/shifted/started/stopped"],
  "persistent": ["3-5 stable elements using remained/stayed/continued/unchanged"],
  "events": [{"t": 0, "description": "≤12 word moment"}],
  "anomalies": ["unusual observations if any, else empty"],
  "escalations": ["urgent items if any, else empty"],
  "confidence": 0.85
}

RULES:
• summary: MAX 50 words total. Be brief.
• changes: Describe TRANSITIONS (entered, exited, moved from X to Y, started, stopped)
• persistent: Describe CONTINUITY (remained, stayed, continued, unchanged)
• events: 3-6 timestamped moments, ≤12 words each
• NEVER return empty arrays for changes, persistent, or events
• Output valid JSON only - no extra text`;

  const payload = {
    prompt,
    observations: observationsPayload,
    max_new_tokens: 1024,
  };

  try {
    const response = await fetch(`${COSMOS_ENDPOINT}/reason`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cosmos /reason API error: ${response.status} - ${errorText}`);
    }

    const apiResult = await response.json();
    const rawText = apiResult.raw_text || "";
    
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
              changes: Array.isArray(parsed.changes) ? parsed.changes : [],
              persistent: Array.isArray(parsed.persistent) ? parsed.persistent : [],
              events: Array.isArray(parsed.events) ? parsed.events : [],
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/prompts", async (_req, res) => {
    try {
      const prompts = await storage.getPrompts();
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

      console.log(`[Scene Agent] Starting analysis of ${frames.length} frames over ${durationSeconds}s (2 concurrent)`);
      const startTime = new Date().toISOString();

      const observations: FrameObservation[] = [];
      const CONCURRENCY = 2;
      
      for (let i = 0; i < frames.length; i += CONCURRENCY) {
        const batch = frames.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map((frame, batchIndex) => {
          const frameIndex = i + batchIndex;
          const timestampOffset = frameIndex * intervalSeconds;
          console.log(`[Scene Agent] Analyzing frame ${frameIndex + 1}/${frames.length} at T+${timestampOffset}s`);
          return getSceneObservation(frame, timestampOffset, sceneContext).then(result => ({
            t: timestampOffset,
            text: result.text,
            confidence: result.confidence,
          }));
        });
        
        const batchResults = await Promise.all(batchPromises);
        observations.push(...batchResults);
      }
      
      console.log(`[Scene Agent] All ${observations.length} frames analyzed`);

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
