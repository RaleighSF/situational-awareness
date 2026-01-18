import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { insertPromptSchema, insertAlertSchema, sceneAgentRequestSchema, sceneAgentSynthesisSchema, sourceSettingsSchema } from "@shared/schema";
import type { BoundingBox, FrameObservation, SceneAgentSynthesis, SceneAgentResult } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { ObjectStorageService, ObjectNotFoundError } from "./replit_integrations/object_storage";

const objectStorageService = new ObjectStorageService();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ATTACHED_ASSETS_DIR = path.join(process.cwd(), "attached_assets");
if (!fs.existsSync(ATTACHED_ASSETS_DIR)) {
  fs.mkdirSync(ATTACHED_ASSETS_DIR, { recursive: true });
}

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `video-${uniqueSuffix}${ext}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only MP4, WebM, OGG, and MOV videos are allowed."));
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
});

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT || "https://cosmos.agentdemos.com";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

type QuestionType = "precision" | "situational";

function classifyPrompt(userPrompt: string): QuestionType {
  const precisionKeywords = [
    "count", "how many", "number of", "quantity", "total",
    "exactly", "precise", "measure", "dimension", "size",
    "height", "width", "length", "distance", "percentage",
    "ratio", "amount", "sum", "tally", "enumerate"
  ];
  
  const lowerPrompt = userPrompt.toLowerCase();
  
  for (const keyword of precisionKeywords) {
    if (lowerPrompt.includes(keyword)) {
      console.log(`[ROUTER] Classified as PRECISION (matched: "${keyword}")`);
      return "precision";
    }
  }
  
  console.log("[ROUTER] Classified as SITUATIONAL (no precision keywords found)");
  return "situational";
}

async function analyzeWithGPT4o(frameData: string, userPrompt: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  const payload = {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a precision visual analysis assistant. Your specialty is accurate counting and measurement of objects in images. 

IMPORTANT RULES:
- Only count objects that are CLEARLY and FULLY visible
- Do not estimate or guess about partially hidden objects
- If objects are stacked or occluded, only count what you can definitively see
- Be conservative in your counts - accuracy is more important than completeness
- State your confidence level and any limitations in your answer`
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt
          },
          {
            type: "image_url",
            image_url: {
              url: frameData,
              detail: "high"
            }
          }
        ]
      }
    ],
    max_tokens: 1024
  };

  console.log("[GPT-4o] --> Sending precision analysis request");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[GPT-4o] Error:", errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "";
  console.log(`[GPT-4o] <-- Response: ${content.length} chars`);
  return content;
}

function stripChatMarkers(text: string): string {
  let cleaned = text
    .replace(/^#{1,3}\s*(User|Assistant|System):\s*/gim, '')
    .replace(/^(user|assistant|system):\s*/gim, '')
    .replace(/<\|?(user|assistant|system|im_start|im_end|end_of_turn)\|?>\n?/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/<<SYS>>|<<\/SYS>>/gi, '')
    .replace(/^\s*assistant\s*\n/gim, '')
    .replace(/^\s*user\s*\n/gim, '')
    .trim();
  return cleaned;
}

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
  boundingBox: BoundingBox | null = null,
  sceneContext?: string
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

  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const fullPrompt = `${contextPreamble}Task: ${prompt}

Provide your analysis in this format:
DETECTED: [YES or NO]
CONFIDENCE: [HIGH, MEDIUM, or LOW]
SIGNALS: [describe any warning signs, hazards, or notable indicators you observe]
ANALYSIS: [your detailed assessment]
RECOMMENDED_ACTIONS: [what should be done, or "None" if nothing needed]`;

  const roi = boundingBoxToROI(boundingBox);

  const payload: {
    image_b64: string;
    prompt: string;
    max_new_tokens: number;
    roi?: CosmosROI;
  } = {
    image_b64: base64Data,
    prompt: fullPrompt,
    max_new_tokens: 512,
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
    const rawContent = result.text || "";
    const content = stripChatMarkers(rawContent);
    
    // Normalize: insert line breaks before headers for consistent parsing
    const normalized = content.replace(/\s*(DETECTED|CONFIDENCE|SIGNALS|ANALYSIS|RECOMMENDED_ACTIONS):/gi, '\n$1:');

    const detectedMatch = normalized.match(/DETECTED:\s*(YES|NO)/i);
    const confidenceMatch = normalized.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
    
    // Extract each section up to the next header
    const extractSection = (text: string, header: string): string => {
      const regex = new RegExp(`${header}:\\s*([\\s\\S]*?)(?=\\n(?:DETECTED|CONFIDENCE|SIGNALS|ANALYSIS|RECOMMENDED_ACTIONS):|$)`, 'i');
      const match = text.match(regex);
      return match?.[1]?.trim() || "";
    };
    
    const signals = extractSection(normalized, 'SIGNALS');
    const analysisText = extractSection(normalized, 'ANALYSIS');
    const actions = extractSection(normalized, 'RECOMMENDED_ACTIONS');

    const detected = detectedMatch?.[1]?.toUpperCase() === "YES";
    const confidence = confidenceMatch?.[1]?.toUpperCase() || "MEDIUM";
    
    // Build formatted analysis with clean sections
    const sections: string[] = [];
    if (signals) sections.push(`SIGNALS: ${signals}`);
    if (analysisText) sections.push(`ANALYSIS: ${analysisText}`);
    if (actions) sections.push(`RECOMMENDED_ACTIONS: ${actions}`);
    const analysis = sections.length > 0 ? sections.join('\n\n') : content;

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

async function analyzeWithCosmosAdhocDirect(frameData: string, userPrompt: string, sceneContext?: string): Promise<string> {
  const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
  const base64Data = dataUrlMatch 
    ? frameData.slice(dataUrlMatch[0].length)
    : frameData;

  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const prompt = `${contextPreamble}Analyze this image. User question: "${userPrompt}"

Describe what you observe and answer the question directly.`;

  const payload = {
    image_b64: base64Data,
    prompt,
    max_new_tokens: 1024,
  };

  const targetUrl = `${COSMOS_ENDPOINT}/infer`;
  console.log(`[COSMOS] --> ${targetUrl}`);

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cosmos API error: ${response.status} - ${errorText}`);
  }

  const apiResult = await response.json();
  console.log(`[COSMOS] <-- API result keys: ${Object.keys(apiResult).join(', ')}`);
  const rawContent = apiResult.text || apiResult.raw_text || apiResult.result || "";
  const content = stripChatMarkers(rawContent);
  console.log(`[COSMOS] <-- Response: ${content.length} chars`);
  return content;
}

async function analyzeWithCosmosAdhoc(frameData: string, userPrompt: string, sceneContext?: string): Promise<{ result: string; model: string }> {
  if (!frameData || frameData.length < 100) {
    return { result: "Invalid frame captured - video may not be loaded", model: "none" };
  }

  // NOTE: Intelligent routing code preserved but bypassed for fastest response times
  // To re-enable routing, uncomment the block below:
  /*
  const questionType = classifyPrompt(userPrompt);
  
  if (questionType === "precision" && OPENAI_API_KEY) {
    try {
      console.log("[ROUTER] Routing to GPT-4o for precision analysis");
      const result = await analyzeWithGPT4o(frameData, userPrompt);
      return { result, model: "gpt-4o" };
    } catch (error) {
      console.error("[ROUTER] GPT-4o failed, falling back to Cosmos:", error);
      const result = await analyzeWithCosmosAdhocDirect(frameData, userPrompt, sceneContext);
      return { result, model: "cosmos-reason2" };
    }
  }
  */

  // Direct route to Cosmos for all queries
  const result = await analyzeWithCosmosAdhocDirect(frameData, userPrompt, sceneContext);
  return { result, model: "cosmos-reason2" };
}

async function getBatchSceneObservations(
  frames: string[], 
  intervalSeconds: number, 
  sceneContext?: string
): Promise<FrameObservation[]> {
  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const prompt = `${contextPreamble}You are analyzing a time-ordered sequence. Keep the structure identical for each frame so changes can be compared across time.

You are an operations-grade scene analyst. Analyze this single video frame and return concise, factual observations only. Use this structure exactly:
SCENE: (1 sentence of what's happening and where)
ENTITIES: (people/machines with rough counts only if confident)
OBJECTS: (packages/conveyors/labels with notable attributes)
ACTIONS: (what is moving or changing in this frame)
SIGNALS: (icons like fragile, hazards, jams, PPE)
COUNTS: (only numbers you are confident in, otherwise 'uncertain')
NOTABLE DETAIL: (one subtle but important observation)

Be factual and say 'uncertain' if resolution limits confidence.`;

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
      text: stripChatMarkers(r.text || "No observation generated"),
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

  const prompt = `${contextPreamble}You are a situational-awareness analyst summarizing multiple frame observations from a single camera over a short time window. Use only the provided observations. Produce a report with these sections only:

SUMMARY: (2-4 sentence executive overview)
WHAT CHANGED: (bulleted transitions such as entered/exited, moved from X to Y, started/stopped)
WHAT STAYED THE SAME: (persistent elements)
TIMELINE: (T+ timestamps with short factual events)
RISKS / ANOMALIES: (if any, otherwise 'None observed')
CONFIDENCE: (0.0-1.0 with brief justification)

Be punchy, concrete, and avoid speculation.`;

  const payload = {
    prompt,
    observations: observationsPayload,
    max_new_tokens: 2048,
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
    
    const rawTextUncleaned = apiResult.raw_text || apiResult.text || "";
    const rawText = stripChatMarkers(rawTextUncleaned);
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
      const extractSection = (text: string, headers: string[], nextHeaders: string[]): string => {
        for (const header of headers) {
          const headerRegex = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?${header}(?:\\*\\*)?:?\\s*`, 'i');
          const match = text.match(headerRegex);
          if (match) {
            const startIdx = match.index! + match[0].length;
            let endIdx = text.length;
            for (const next of nextHeaders) {
              const nextRegex = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?${next}(?:\\*\\*)?:?\\s*`, 'i');
              const nextMatch = text.substring(startIdx).match(nextRegex);
              if (nextMatch && nextMatch.index !== undefined) {
                endIdx = Math.min(endIdx, startIdx + nextMatch.index);
              }
            }
            return text.substring(startIdx, endIdx).trim();
          }
        }
        return "";
      };

      const allNextHeaders = ['Summary', 'Overview', 'What Changed', 'What Stayed', 'Timeline', 'Events', 'Risks', 'Anomalies', 'Confidence'];
      const summary = extractSection(rawText, ['Summary', 'Overview', 'Key Takeaway'], allNextHeaders) || rawText.substring(0, 400);
      const timeline = extractSection(rawText, ['Timeline', 'Events', 'Key Events', 'Moments'], ['Risks', 'Anomalies', 'Confidence']);
      const anomalies = extractSection(rawText, ['Risks / Anomalies', 'Risks', 'Anomalies', 'Anomaly', 'Unusual'], ['Confidence']);
      const confidenceStr = extractSection(rawText, ['Confidence', 'Certainty'], []);
      
      const events: { t: number; description: string }[] = [];
      const timelineLines = timeline.split(/[\n\r]+/).filter(l => l.trim());
      for (const line of timelineLines) {
        const timeMatch = line.match(/T\+\s*(\d+)\s*s?|(?:t\s*[=:]?\s*)?(\d+)\s*s(?:ec(?:onds?)?)?|(\d{1,2}):(\d{2})/i);
        let t = events.length * 5;
        if (timeMatch) {
          if (timeMatch[1]) {
            t = parseInt(timeMatch[1]);
          } else if (timeMatch[2]) {
            t = parseInt(timeMatch[2]);
          } else if (timeMatch[3] && timeMatch[4]) {
            t = parseInt(timeMatch[3]) * 60 + parseInt(timeMatch[4]);
          }
        }
        const description = line.replace(/^[-•*]\s*/, '').replace(/T\+\s*\d+\s*s?\s*[-:–]?\s*/i, '').replace(/(?:t\s*[=:]?\s*)?\d+\s*s(?:ec(?:onds?)?)?\s*[-:–]?\s*/i, '').replace(/\d{1,2}:\d{2}\s*[-:–]?\s*/, '').trim();
        if (description && description.length > 5) {
          events.push({ t, description: description.substring(0, 100) });
        }
      }

      const anomalyList = anomalies.split(/[\n\r]+/).filter(l => l.trim()).map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(l => l.length > 3).slice(0, 6);
      
      let confidence = 0.5;
      const confMatch = confidenceStr.match(/([\d.]+)/);
      if (confMatch) {
        const val = parseFloat(confMatch[1]);
        confidence = val > 1 ? val / 100 : val;
      } else if (/high/i.test(confidenceStr) || /high/i.test(rawText.substring(rawText.length - 200))) {
        confidence = 0.85;
      } else if (/low/i.test(confidenceStr)) {
        confidence = 0.35;
      }
      
      return {
        synthesis: {
          summary: summary.substring(0, 400) || "Analysis complete.",
          events: events.length > 0 ? events.slice(0, 8) : [{ t: 0, description: "Scene observed" }],
          anomalies: anomalyList,
          escalations: [],
          confidence,
        },
        rawText,
      };
    }

    return { synthesis: { summary: rawText.substring(0, 400) || "Analysis complete.", events: [], anomalies: [], escalations: [], confidence: 0.5 }, rawText };
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

  app.post("/api/video-sources/upload", videoUpload.single("video"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file provided" });
      }
      const name = req.body.name || path.parse(req.file.originalname).name;
      
      // Create a clean filename from the video name
      const ext = path.extname(req.file.filename);
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const persistentFilename = `${cleanName}${ext}`;
      const persistentPath = path.join(ATTACHED_ASSETS_DIR, persistentFilename);
      
      // Copy to attached_assets for deployment persistence
      fs.copyFileSync(path.join(UPLOADS_DIR, req.file.filename), persistentPath);
      console.log(`[Upload] Copied video to attached_assets: ${persistentFilename}`);
      
      // Use attached_assets URL for persistence across deployments
      const videoUrl = `/attached_assets/${persistentFilename}`;
      
      const source = await storage.createVideoSource({
        name,
        url: videoUrl,
        isActive: true,
        settings: null,
      });
      res.status(201).json(source);
    } catch (error) {
      console.error("Error uploading video:", error);
      res.status(500).json({ error: "Failed to upload video" });
    }
  });

  app.post("/api/video-sources/request-upload-url", async (req, res) => {
    try {
      const { name, contentType } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Video name is required" });
      }
      const allowedTypes = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
      if (contentType && !allowedTypes.includes(contentType)) {
        return res.status(400).json({ error: "Invalid video type. Only MP4, WebM, OGG, and MOV are allowed." });
      }
      // Use public upload URL so videos are accessible in production without sidecar
      const { uploadUrl, publicUrl, objectPath } = await objectStorageService.getPublicObjectUploadURL();
      res.json({ uploadURL: uploadUrl, objectPath, publicUrl, name });
    } catch (error) {
      console.error("Error generating video upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.post("/api/video-sources/complete-upload", async (req, res) => {
    try {
      const { name, publicUrl } = req.body;
      if (!name || !publicUrl) {
        return res.status(400).json({ error: "Name and publicUrl are required" });
      }
      // Use the direct public GCS URL for production compatibility
      // Videos in the public directory are accessible without authentication
      const source = await storage.createVideoSource({
        name,
        url: publicUrl,
        isActive: true,
        settings: null,
      });
      res.status(201).json(source);
    } catch (error) {
      console.error("Error completing video upload:", error);
      res.status(500).json({ error: "Failed to complete video upload" });
    }
  });

  app.get("/objects/*", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      res.setHeader("Accept-Ranges", "bytes");
      await objectStorageService.downloadObject(objectFile, res, 86400);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Video not found" });
      }
      console.error("Error serving object:", error);
      res.status(500).json({ error: "Failed to serve video" });
    }
  });

  app.delete("/api/video-sources/:id", async (req, res) => {
    try {
      const source = await storage.getVideoSource(req.params.id);
      if (!source) {
        return res.status(404).json({ error: "Video source not found" });
      }
      await storage.deletePromptsByVideoSource(req.params.id);
      if (source.url.startsWith("/uploads/")) {
        const filePath = path.join(process.cwd(), source.url);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } else if (source.url.startsWith("/objects/")) {
        try {
          await objectStorageService.deleteObjectEntity(source.url);
        } catch (error) {
          console.warn("Failed to delete object from storage:", error);
        }
      }
      await storage.deleteVideoSource(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting video source:", error);
      res.status(500).json({ error: "Failed to delete video source" });
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

  app.get("/api/alerts", async (req, res) => {
    try {
      const { videoSourceId } = req.query;
      let alertList;
      if (videoSourceId && typeof videoSourceId === "string") {
        alertList = await storage.getAlertsByVideoSource(videoSourceId);
      } else {
        alertList = await storage.getAlerts();
      }
      res.json(alertList);
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

  app.post("/api/analyze-adhoc", async (req, res) => {
    try {
      const { frameData, prompt, sceneContext } = req.body;

      if (!frameData || !prompt) {
        return res.status(400).json({ error: "frameData and prompt are required" });
      }

      const { result, model } = await analyzeWithCosmosAdhoc(frameData, prompt.trim(), sceneContext);
      res.json({ analysis: result, model });
    } catch (error) {
      console.error("Error in ad-hoc analysis:", error);
      res.status(500).json({ error: "Failed to analyze frame" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { frameData, promptId, sceneContext } = req.body;

      if (!frameData || !promptId) {
        return res.status(400).json({ error: "frameData and promptId are required" });
      }

      const prompt = await storage.getPrompt(promptId);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const result = await analyzeWithCosmos(frameData, prompt.prompt, prompt.boundingBox, sceneContext);

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(`${COSMOS_ENDPOINT}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        res.json({ 
          status: "healthy", 
          endpoint: COSMOS_ENDPOINT,
          apiLive: true,
          modelLoaded: data.model_loaded ?? false,
          gpu: data.gpu ?? null,
          modelId: data.model_id ?? null,
          cuda: data.cuda ?? false
        });
      } else {
        res.status(503).json({ 
          status: "unhealthy", 
          endpoint: COSMOS_ENDPOINT,
          apiLive: true,
          modelLoaded: false 
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      res.status(503).json({ 
        status: "unavailable", 
        endpoint: COSMOS_ENDPOINT,
        apiLive: false,
        modelLoaded: false,
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
