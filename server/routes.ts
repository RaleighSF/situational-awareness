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

// ROI format for Cosmos API: [x1, y1, x2, y2] normalized 0..1
type CosmosROI = [number, number, number, number];

function boundingBoxToROI(boundingBox: BoundingBox | null): CosmosROI | undefined {
  if (!boundingBox) return undefined;
  // Convert from {x, y, width, height} percentage to [x1, y1, x2, y2] normalized
  const x1 = boundingBox.x / 100;
  const y1 = boundingBox.y / 100;
  const x2 = (boundingBox.x + boundingBox.width) / 100;
  const y2 = (boundingBox.y + boundingBox.height) / 100;
  return [x1, y1, x2, y2];
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

  const roi = boundingBoxToROI(boundingBox);

  // Build condition with optional scene context
  const conditionWithContext = sceneContext 
    ? `[Context: ${sceneContext}] ${prompt}` 
    : prompt;

  const payload: {
    image_b64: string;
    prompt: string;
    mode: string;
    max_new_tokens: number;
    roi?: CosmosROI;
  } = {
    image_b64: base64Data,
    prompt: conditionWithContext,
    mode: "detect",
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
    const rawContent = result.text || "";
    const content = stripChatMarkers(rawContent);

    const detectedMatch = content.match(/DETECTED:\s*(YES|NO)/i);
    const confidenceMatch = content.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
    const analysisMatch = content.match(/ANALYSIS:\s*([\s\S]+)/i);

    const detected = detectedMatch?.[1]?.toUpperCase() === "YES";
    const confidence = confidenceMatch?.[1]?.toUpperCase() || "MEDIUM";
    
    let analysis = analysisMatch?.[1]?.trim() || content;
    // Strip echoed prompt instructions that the model sometimes repeats
    analysis = analysis
      .replace(/^Brief description of what you observe\s*/i, '')
      .replace(/^\d+-\d+\s+sentences\s+explaining[^.]+\.\s*/i, '')
      .replace(/^Be\s+direct\.\s*Do\s+not\s+include[^.]+\.\s*/i, '')
      .replace(/^Examine\s+the\s+image[^.]+\.\s*/i, '')
      .replace(/^Report\s+in\s+this\s+exact\s+format[^:]*:\s*/i, '')
      .replace(/^DETECTED:\s*(YES|NO)\s*/i, '')
      .replace(/^CONFIDENCE:\s*(HIGH|MEDIUM|LOW)\s*/i, '')
      .replace(/^ANALYSIS:\s*/i, '')
      .replace(/\n*DETECTED:\s*(YES|NO)\s*/i, '\n')
      .replace(/\n*CONFIDENCE:\s*(HIGH|MEDIUM|LOW)\s*/i, '\n')
      .replace(/\n*ANALYSIS:\s*/i, '\n')
      .replace(/^\s*\n+/, '')
      .trim();

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

interface CountItem {
  id: number;
  label: string;
  confidence: number;
  box: [number, number, number, number];
}

interface MarkCountResult {
  count: number;
  items: CountItem[];
  notes?: string;
}

async function classifyCountingIntent(userPrompt: string): Promise<boolean> {
  if (!OPENAI_API_KEY) {
    console.log("[CLASSIFY] No OpenAI API key, using pattern matching fallback");
    return isCountingPromptFallback(userPrompt);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a classifier that determines if a user's question about an image requires counting or enumeration. 

Respond with ONLY "count" or "qa" (no other text).

Respond "count" for:
- "How many..." questions
- "Count the..." requests  
- "Number of..." queries
- Inventory-style questions ("How many boxes/cars/people?")
- Comparison counts ("Are there more than N...")
- Attribute-specific counts ("How many have white labels?", "How many wearing hard hats?")
- List and count requests ("List each ... and count them")
- Location-specific counts ("How many pallets on the left?", "How many vehicles in the lane?")

Respond "qa" for:
- Descriptions ("What's happening?", "Describe the scene")
- Reasoning ("Is this unsafe?", "Why did the alert fire?")
- Policy/intent questions ("Is someone unauthorized?")
- Summaries ("Summarize the scene")
- Yes/no questions not about quantity
- Identification questions ("What type of vehicle is that?")`
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        max_tokens: 10,
        temperature: 0
      })
    });

    if (!response.ok) {
      console.error("[CLASSIFY] OpenAI API error:", response.status);
      return isCountingPromptFallback(userPrompt);
    }

    const result = await response.json();
    const classification = result.choices?.[0]?.message?.content?.trim().toLowerCase() || "qa";
    console.log(`[CLASSIFY] "${userPrompt.substring(0, 50)}..." -> ${classification}`);
    return classification === "count";
  } catch (error) {
    console.error("[CLASSIFY] Error:", error);
    return isCountingPromptFallback(userPrompt);
  }
}

function isCountingPromptFallback(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  const countingPatterns = [
    /how many/i,
    /count the/i,
    /number of/i,
    /\bhow\s+many\b/i,
    /\bcount\b/i,
    /are there more than \d+/i,
    /list each .* and count/i,
    /\btotal\b.*\b(items?|objects?|people|persons?|vehicles?|cars?|boxes?)\b/i,
  ];
  return countingPatterns.some(pattern => pattern.test(lowerPrompt));
}

async function analyzeWithCosmosMarkCount(
  frameData: string, 
  userPrompt: string, 
  roi?: [number, number, number, number],
  sceneContext?: string
): Promise<MarkCountResult> {
  const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
  const base64Data = dataUrlMatch 
    ? frameData.slice(dataUrlMatch[0].length)
    : frameData;

  const questionWithContext = sceneContext 
    ? `[Context: ${sceneContext}] ${userPrompt}` 
    : userPrompt;

  const payload: {
    mode: string;
    prompt: string;
    image_b64: string;
    max_image_side: number;
    max_new_tokens: number;
    roi?: [number, number, number, number];
  } = {
    mode: "mark_count",
    prompt: questionWithContext,
    image_b64: base64Data,
    max_image_side: 768,
    max_new_tokens: 128,
  };

  if (roi) {
    payload.roi = roi;
  }

  const targetUrl = `${COSMOS_ENDPOINT}/infer`;
  console.log(`[MARK_COUNT] --> ${targetUrl}`);
  console.log(`[MARK_COUNT] Image size: ${base64Data.length} chars, prompt: "${questionWithContext.substring(0, 50)}..."`);

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cosmos mark_count API error: ${response.status} - ${errorText}`);
  }

  const apiResult = await response.json();
  console.log(`[MARK_COUNT] <-- API result:`, JSON.stringify(apiResult).substring(0, 500));

  // Cosmos mark_count may return data in different formats:
  // 1. Direct: { count: N, items: [...] }
  // 2. Wrapped: { text: "{ count: N, ... }" } (JSON string in text field)
  // 3. Text response: { text: "There are N items..." } (natural language)
  
  let count = 0;
  let items: CountItem[] = [];
  let notes: string | undefined;

  // Helper to normalize items to CountItem format
  const normalizeItems = (rawItems: unknown[]): CountItem[] => {
    return rawItems.map((item: any, idx: number) => ({
      id: item.id ?? idx + 1,
      label: item.label ?? `Item ${idx + 1}`,
      confidence: item.confidence ?? 0.5,
      box: item.box ?? [0, 0, 1, 1],
    }));
  };

  // Try direct count field first
  if (typeof apiResult.count === 'number') {
    count = apiResult.count;
    items = normalizeItems(apiResult.items || []);
    notes = apiResult.notes;
  } 
  // Try parsing text field as JSON
  else if (apiResult.text) {
    const textContent = stripChatMarkers(apiResult.text);
    try {
      const parsed = JSON.parse(textContent);
      count = parsed.count ?? 0;
      items = normalizeItems(parsed.items || []);
      notes = parsed.notes;
    } catch {
      // Text field contains natural language - parse for count
      const countMatch = textContent.match(/(\d+)/);
      count = countMatch ? parseInt(countMatch[1], 10) : 0;
      notes = textContent;
    }
  }
  // Try raw_text or result fields
  else if (apiResult.raw_text || apiResult.result) {
    const textContent = stripChatMarkers(apiResult.raw_text || apiResult.result);
    const countMatch = textContent.match(/(\d+)/);
    count = countMatch ? parseInt(countMatch[1], 10) : 0;
    notes = textContent;
  }

  console.log(`[MARK_COUNT] Parsed: count=${count}, items=${items.length}`);
  return { count, items, notes };
}

async function analyzeWithCosmosAdhocDirect(frameData: string, userPrompt: string, sceneContext?: string): Promise<string> {
  const dataUrlMatch = frameData.match(/^data:image\/([a-zA-Z]+);base64,/);
  const base64Data = dataUrlMatch 
    ? frameData.slice(dataUrlMatch[0].length)
    : frameData;

  // Build question with optional scene context
  const questionWithContext = sceneContext 
    ? `[Context: ${sceneContext}] ${userPrompt}` 
    : userPrompt;

  const payload = {
    image_b64: base64Data,
    prompt: questionWithContext,
    mode: "qa",
    max_new_tokens: 512,
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

interface AdhocAnalysisResult {
  result: string;
  model: string;
  mode: "qa" | "mark_count";
  countData?: MarkCountResult;
}

async function analyzeWithCosmosAdhoc(
  frameData: string, 
  userPrompt: string, 
  sceneContext?: string,
  roi?: [number, number, number, number]
): Promise<AdhocAnalysisResult> {
  if (!frameData || frameData.length < 100) {
    return { result: "Invalid frame captured - video may not be loaded", model: "none", mode: "qa" };
  }

  // Use OpenAI to classify if this is a counting query
  const isCountingQuery = await classifyCountingIntent(userPrompt);
  
  if (isCountingQuery) {
    console.log("[ROUTER] Routing to mark_count mode for counting query");
    try {
      const countResult = await analyzeWithCosmosMarkCount(frameData, userPrompt, roi, sceneContext);
      
      // Format a readable result string
      let resultText = `Count: ${countResult.count}`;
      if (countResult.items && countResult.items.length > 0) {
        resultText += `\n\nItems detected:`;
        countResult.items.forEach((item, i) => {
          resultText += `\n${i + 1}. ${item.label} (${Math.round(item.confidence * 100)}% confidence)`;
        });
      }
      if (countResult.notes) {
        resultText += `\n\nNotes: ${countResult.notes}`;
      }
      
      return { 
        result: resultText, 
        model: "cosmos-reason2-count", 
        mode: "mark_count",
        countData: countResult 
      };
    } catch (error) {
      console.error("[ROUTER] mark_count failed, falling back to qa:", error);
      const result = await analyzeWithCosmosAdhocDirect(frameData, userPrompt, sceneContext);
      return { result, model: "cosmos-reason2", mode: "qa" };
    }
  }

  // Route to QA mode for non-counting queries
  console.log("[ROUTER] Routing to qa mode for general query");
  const result = await analyzeWithCosmosAdhocDirect(frameData, userPrompt, sceneContext);
  return { result, model: "cosmos-reason2", mode: "qa" };
}

async function getBatchSceneObservations(
  frames: string[], 
  intervalSeconds: number, 
  sceneContext?: string
): Promise<FrameObservation[]> {
  const contextPreamble = sceneContext 
    ? `Scene Context: ${sceneContext}\n\n` 
    : "";

  const prompt = `${contextPreamble}Security camera observation. Describe scene state: people (count, positions, actions, movement direction), objects (type, location, state), vehicles/equipment (type, motion), and notable signals or changes. Be concise and factual.`;

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
  }));

  // Calculate total time span from observations
  const maxT = Math.max(...observations.map(o => o.t));
  const totalSeconds = maxT > 0 ? maxT : observations.length * 5;

  const payload = {
    observations: observationsPayload,
    total_seconds: totalSeconds,
    max_new_tokens: 768,
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
    
    // Debug: log the full API response structure
    console.log(`[REASON] API response keys:`, Object.keys(apiResult));
    console.log(`[REASON] Full API response:`, JSON.stringify(apiResult).substring(0, 500));
    
    // The API returns synthesis fields at the root level (summary, changes, persistent, timeline, etc.)
    // Also has 'raw' field with the raw model output, and '_latency_ms' for timing
    const rawTextUncleaned = apiResult.raw || apiResult.raw_text || apiResult.text || "";
    const rawText = stripChatMarkers(rawTextUncleaned);
    const responseChars = rawText.length;
    const responseWords = rawText.split(/\s+/).length;
    
    console.log(`[REASON] body parsed: +${parseMs}ms | TOTAL: ${totalMs}ms | ${responseWords} words, ${responseChars} chars`);
    
    // The API returns synthesis data at root level - use it directly
    if (apiResult.summary && typeof apiResult.summary === 'string') {
      // Parse timeline events (server format: {t, event})
      const timeline: { t: number; event: string }[] = [];
      if (Array.isArray(apiResult.timeline)) {
        for (const item of apiResult.timeline) {
          const t = typeof item.t === 'number' ? item.t : 0;
          const eventText = item.event || '';
          const event = eventText.replace(/^\d+s?:\s*/, '').trim();
          if (event && event !== "None") {
            timeline.push({ t, event: event.substring(0, 150) });
          }
        }
      }

      // Handle escalation (singular array from server)
      const escalation = Array.isArray(apiResult.escalation) 
        ? apiResult.escalation.filter((e: string) => e && e !== "None")
        : [];

      const anomalies = Array.isArray(apiResult.anomalies)
        ? apiResult.anomalies.filter((a: string) => a && a !== "None observed" && a !== "None")
        : [];

      const changes = Array.isArray(apiResult.changes)
        ? apiResult.changes.filter((c: string) => c && c !== "None")
        : [];

      const persistent = Array.isArray(apiResult.persistent)
        ? apiResult.persistent.filter((p: string) => p && p !== "None")
        : [];

      const confidence = typeof apiResult.confidence === 'number' 
        ? Math.min(1, Math.max(0, apiResult.confidence))
        : 0.5;

      // Check if the summary indicates a parsing error from the API
      const summaryText = apiResult.summary === "Synthesis returned non-JSON output." 
        ? "Scene analysis complete."
        : apiResult.summary;

      console.log(`[REASON] Using root-level synthesis: ${summaryText.substring(0, 80)}...`);
      
      return {
        synthesis: {
          summary: summaryText.substring(0, 400),
          timeline: timeline.length > 0 ? timeline.slice(0, 8) : [{ t: 0, event: "Scene observed" }],
          changes,
          persistent,
          anomalies,
          escalation,
          confidence,
        },
        rawText,
      };
    }
    
    // Fallback: Try to parse the structured result from apiResult.result
    if (apiResult.result) {
      const parseResult = sceneAgentSynthesisSchema.safeParse(apiResult.result);
      if (parseResult.success) {
        return { synthesis: parseResult.data, rawText };
      }
      console.error("Failed to validate synthesis result:", parseResult.error);
    }

    // Try to parse JSON from raw text (server returns JSON)
    if (rawText) {
      try {
        // Extract JSON from response (may have surrounding text)
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          
          // Parse timeline events (server format: {t, event})
          const timeline: { t: number; event: string }[] = [];
          if (Array.isArray(parsed.timeline)) {
            for (const item of parsed.timeline) {
              const t = typeof item.t === 'number' ? item.t : 0;
              const eventText = item.event || '';
              // Strip timestamp prefix from event text (e.g., "0s: Worker enters" → "Worker enters")
              const event = eventText.replace(/^\d+s?:\s*/, '').trim();
              if (event) {
                timeline.push({ t, event: event.substring(0, 150) });
              }
            }
          }

          // Handle escalation (singular array from server)
          const escalation = Array.isArray(parsed.escalation) 
            ? parsed.escalation.filter((e: string) => e && e !== "None")
            : Array.isArray(parsed.escalations)
              ? parsed.escalations.filter((e: string) => e && e !== "None")
              : [];

          const anomalies = Array.isArray(parsed.anomalies)
            ? parsed.anomalies.filter((a: string) => a && a !== "None observed" && a !== "None")
            : [];

          const changes = Array.isArray(parsed.changes)
            ? parsed.changes.filter((c: string) => c && c !== "None")
            : [];

          const persistent = Array.isArray(parsed.persistent)
            ? parsed.persistent.filter((p: string) => p && p !== "None")
            : [];

          const confidence = typeof parsed.confidence === 'number' 
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0.5;

          return {
            synthesis: {
              summary: (parsed.summary || "Analysis complete.").substring(0, 400),
              timeline: timeline.length > 0 ? timeline.slice(0, 8) : [{ t: 0, event: "Scene observed" }],
              changes,
              persistent,
              anomalies,
              escalation,
              confidence,
            },
            rawText,
          };
        }
      } catch (jsonError) {
        console.log("[REASON] JSON parse failed, using fallback:", jsonError);
      }

      // Fallback: use raw text as summary
      return {
        synthesis: {
          summary: rawText.substring(0, 400) || "Analysis complete.",
          timeline: [{ t: 0, event: "Scene observed" }],
          changes: [],
          persistent: [],
          anomalies: [],
          escalation: [],
          confidence: 0.5,
        },
        rawText,
      };
    }

    return { synthesis: { summary: "Analysis complete.", timeline: [], changes: [], persistent: [], anomalies: [], escalation: [], confidence: 0.5 }, rawText };
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
      const { frameData, prompt, sceneContext, roi } = req.body;

      if (!frameData || !prompt) {
        return res.status(400).json({ error: "frameData and prompt are required" });
      }

      // Validate ROI if provided (should be [x1, y1, x2, y2] normalized array)
      let validatedRoi: [number, number, number, number] | undefined;
      if (roi && Array.isArray(roi) && roi.length === 4) {
        const [x1, y1, x2, y2] = roi;
        if (typeof x1 === 'number' && typeof y1 === 'number' && 
            typeof x2 === 'number' && typeof y2 === 'number') {
          validatedRoi = [x1, y1, x2, y2];
        }
      }

      const { result, model, mode, countData } = await analyzeWithCosmosAdhoc(
        frameData, 
        prompt.trim(), 
        sceneContext,
        validatedRoi
      );
      
      res.json({ 
        analysis: result, 
        model, 
        mode,
        countData 
      });
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
