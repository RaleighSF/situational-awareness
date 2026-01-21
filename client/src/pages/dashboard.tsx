import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { VideoPlayer, VideoPlayerRef } from "@/components/video-player";
import { PromptCard } from "@/components/prompt-card";
import { PromptForm } from "@/components/prompt-form";
import { AlertList } from "@/components/alert-list";
import { AlertDetailModal } from "@/components/alert-detail-modal";
import { AnalysisStatus } from "@/components/analysis-status";
import { CosmosHealth } from "@/components/cosmos-health";
import { SceneAgentModal } from "@/components/scene-agent-modal";
import { QuickAnalysisModal } from "@/components/quick-analysis-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Video,
  Crosshair,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  Bot,
  Settings,
  Upload,
  Trash2,
} from "lucide-react";
import nttDataLogo from "@assets/ntt-data-logo.png";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Prompt, Alert, BoundingBox, SceneAgentResult, VideoSource, SourceSettings } from "@shared/schema";

// Protected demo video URLs that cannot be deleted
const PROTECTED_DEMO_URLS = [
  "/attached_assets/4473271-hd_1920_1080_30fps_1768617999296.mp4",
  "/attached_assets/product-picking.mp4",
  "/attached_assets/engine-assembly.mp4",
  "/attached_assets/parking-lot.mp4",
  "/attached_assets/newspaper.mp4",
];

interface PromptSchedule {
  promptId: string;
  frequency: number;
  nextRunAt: number;
  intervalId: NodeJS.Timeout | null;
}

const getVideoUrl = (source: VideoSource | undefined) => {
  if (!source) return "";
  if (source.url.startsWith("/")) {
    return source.url;
  }
  return `/api/video/proxy?url=${encodeURIComponent(source.url)}`;
};

export default function Dashboard() {
  const { toast } = useToast();
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
  const [currentVideoSourceId, setCurrentVideoSourceId] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(true);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [currentBoundingBox, setCurrentBoundingBox] = useState<BoundingBox | null>(null);
  const [isPromptFormOpen, setIsPromptFormOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [isAlertDetailOpen, setIsAlertDetailOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysisTime, setLastAnalysisTime] = useState<Date | null>(null);
  const promptSchedulesRef = useRef<Map<string, PromptSchedule>>(new Map());
  const cachedFrameRef = useRef<{ data: string; timestamp: number } | null>(null);
  const FRAME_CACHE_TTL_MS = 500;
  
  const [isTestResultOpen, setIsTestResultOpen] = useState(false);
  const [testingPrompt, setTestingPrompt] = useState<Prompt | null>(null);
  const [testResult, setTestResult] = useState<{
    detected: boolean;
    analysis: string;
    confidence: string;
    frameData: string;
  } | null>(null);
  const [isTestLoading, setIsTestLoading] = useState(false);
  const activePromptsRef = useRef<string>("");
  
  const [isSceneAgentRunning, setIsSceneAgentRunning] = useState(false);
  const [sceneAgentProgress, setSceneAgentProgress] = useState("");
  
  const [isQuickAnalysisOpen, setIsQuickAnalysisOpen] = useState(false);
  const [quickAnalysisFrame, setQuickAnalysisFrame] = useState<string | null>(null);
  const [sceneAgentPhase, setSceneAgentPhase] = useState<"recording" | "analyzing" | null>(null);
  const [sceneAgentElapsed, setSceneAgentElapsed] = useState(0);
  const [sceneAgentResults, setSceneAgentResults] = useState<Record<string, SceneAgentResult>>({});
  const [isSceneAgentModalOpen, setIsSceneAgentModalOpen] = useState(false);
  const [sceneAgentContext, setSceneAgentContext] = useState("");
  const [isSceneAgentSettingsOpen, setIsSceneAgentSettingsOpen] = useState(false);
  const sceneAgentFramesRef = useRef<string[]>([]);
  
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  
  const [batchCaptureProgress, setBatchCaptureProgress] = useState<{
    promptId: string;
    framesCollected: number;
    totalFrames: number;
  } | null>(null);
  const batchInFlightRef = useRef<Set<string>>(new Set());
  const BATCH_FRAME_COUNT = 7;
  const BATCH_INTERVAL_SECONDS = 2;
  const BATCH_DURATION_SECONDS = 12;

  const { data: videoSources = [], isLoading: sourcesLoading } = useQuery<VideoSource[]>({
    queryKey: ["/api/video-sources"],
  });

  const currentSource = videoSources.find(s => s.id === currentVideoSourceId);
  const currentSceneAgentResult = currentVideoSourceId ? sceneAgentResults[currentVideoSourceId] : null;

  useEffect(() => {
    if (videoSources.length > 0 && !currentVideoSourceId) {
      setCurrentVideoSourceId(videoSources[0].id);
    }
  }, [videoSources, currentVideoSourceId]);

  useEffect(() => {
    if (currentSource?.settings) {
      setCurrentBoundingBox(currentSource.settings.boundingBox || null);
      setSceneAgentContext(currentSource.settings.sceneContext || "");
    } else {
      setCurrentBoundingBox(null);
      setSceneAgentContext("");
    }
  }, [currentSource]);

  const { data: prompts = [], isLoading: promptsLoading } = useQuery<Prompt[]>({
    queryKey: ["/api/prompts", currentVideoSourceId],
    queryFn: async () => {
      if (!currentVideoSourceId) return [];
      const res = await fetch(`/api/prompts?videoSourceId=${currentVideoSourceId}`);
      if (!res.ok) throw new Error("Failed to fetch prompts");
      return res.json();
    },
    enabled: !!currentVideoSourceId,
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts", currentVideoSourceId],
    queryFn: async () => {
      if (!currentVideoSourceId) return [];
      const res = await fetch(`/api/alerts?videoSourceId=${currentVideoSourceId}`);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    enabled: !!currentVideoSourceId,
    refetchInterval: isAnalyzing ? 5000 : false,
  });

  const updateSourceSettingsMutation = useMutation({
    mutationFn: async ({ sourceId, settings }: { sourceId: string; settings: SourceSettings }) => {
      const res = await apiRequest("PATCH", `/api/video-sources/${sourceId}/settings`, settings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/video-sources"] });
    },
  });

  const uploadVideoMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("name", name);
      
      const res = await fetch("/api/video-sources/upload", {
        method: "POST",
        body: formData,
      });
      
      const text = await res.text();
      
      if (!res.ok) {
        let errorMessage = "Failed to upload video";
        try {
          const error = JSON.parse(text);
          errorMessage = error.error || errorMessage;
        } catch {
          if (text) errorMessage = text;
        }
        throw new Error(errorMessage);
      }
      
      return JSON.parse(text) as VideoSource;
    },
    onSuccess: (newSource: VideoSource) => {
      queryClient.invalidateQueries({ queryKey: ["/api/video-sources"] });
      setCurrentVideoSourceId(newSource.id);
      setIsUploadDialogOpen(false);
      setPendingUploadFile(null);
      setUploadFileName("");
      toast({ title: "Video uploaded", description: `"${newSource.name}" is now available as a source.` });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/video-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/video-sources"] });
      if (videoSources.length > 1) {
        const remainingSources = videoSources.filter(s => s.id !== currentVideoSourceId);
        if (remainingSources.length > 0) {
          setCurrentVideoSourceId(remainingSources[0].id);
        }
      }
      toast({ title: "Video source deleted" });
    },
    onError: (error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setPendingUploadFile(file);
      setUploadFileName(file.name.replace(/\.[^/.]+$/, ""));
      setIsUploadDialogOpen(true);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUploadConfirm = () => {
    if (pendingUploadFile && uploadFileName.trim()) {
      uploadVideoMutation.mutate({ file: pendingUploadFile, name: uploadFileName.trim() });
    }
  };

  const handleUploadCancel = () => {
    setIsUploadDialogOpen(false);
    setPendingUploadFile(null);
    setUploadFileName("");
  };

  const saveSourceSettings = useCallback((settings: Partial<SourceSettings>) => {
    if (!currentVideoSourceId) return;
    const currentSettings = currentSource?.settings || {};
    updateSourceSettingsMutation.mutate({
      sourceId: currentVideoSourceId,
      settings: { ...currentSettings, ...settings },
    });
  }, [currentVideoSourceId, currentSource, updateSourceSettingsMutation]);

  const createPromptMutation = useMutation({
    mutationFn: async (data: Omit<Prompt, "id">) => {
      const res = await apiRequest("POST", "/api/prompts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts", currentVideoSourceId] });
      toast({ title: "Detection rule created", description: "The rule is now active and monitoring." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updatePromptMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Prompt> & { id: string }) => {
      const res = await apiRequest("PATCH", `/api/prompts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts", currentVideoSourceId] });
      toast({ title: "Rule updated" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deletePromptMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/prompts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts", currentVideoSourceId] });
      toast({ title: "Rule deleted" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const markAlertReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/alerts/${id}`, { isRead: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts", currentVideoSourceId] });
    },
  });

  const clearAlertsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/alerts");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts", currentVideoSourceId] });
      toast({ title: "All alerts cleared" });
    },
  });

  const analyzeFrameMutation = useMutation({
    mutationFn: async (data: { frameData: string; promptId: string; sceneContext?: string }) => {
      const res = await apiRequest("POST", "/api/analyze", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Analysis failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.alertCreated) {
        queryClient.invalidateQueries({ queryKey: ["/api/alerts", currentVideoSourceId] });
        toast({
          title: "Alert detected!",
          description: "A new detection has been found.",
          variant: "destructive",
        });
      }
      setLastAnalysisTime(new Date());
    },
    onError: (error: Error) => {
      console.error("Analysis error:", error);
      if (error.message.includes("unavailable") || error.message.includes("propagating") || error.message.includes("DNS")) {
        toast({
          title: "Cosmos Endpoint Unavailable",
          description: "The endpoint may still be initializing. Analysis will continue to retry.",
        });
      }
    },
  });

  const scheduleNextBatchRef = useRef<((promptId: string) => void) | null>(null);

  const analyzeBatchMutation = useMutation({
    mutationFn: async (data: { 
      frames: string[]; 
      promptId: string; 
      intervalSeconds: number;
      durationSeconds?: number;
      sceneContext?: string;
    }) => {
      const res = await apiRequest("POST", "/api/analyze-batch", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Batch analysis failed");
      }
      const result = await res.json();
      return { ...result, _promptId: data.promptId };
    },
    onSuccess: (data) => {
      batchInFlightRef.current.delete(data._promptId);
      setBatchCaptureProgress(null);
      console.log(`[BatchAnalysis] API complete for prompt ${data._promptId}, scheduling next batch after cooldown`);
      if (data.alertCreated) {
        queryClient.invalidateQueries({ queryKey: ["/api/alerts", currentVideoSourceId] });
        toast({
          title: "Temporal Alert Detected!",
          description: `Pattern detected across ${data.batchInfo?.frameCount || 7} frames over ${data.batchInfo?.durationSeconds || 12}s.`,
          variant: "destructive",
        });
      }
      setLastAnalysisTime(new Date());
      scheduleNextBatchRef.current?.(data._promptId);
    },
    onError: (error: Error, variables) => {
      batchInFlightRef.current.delete(variables.promptId);
      console.error("Batch analysis error:", error);
      console.log(`[BatchAnalysis] API error for prompt ${variables.promptId}, scheduling next batch after cooldown`);
      setBatchCaptureProgress(null);
      if (error.message.includes("unavailable") || error.message.includes("propagating") || error.message.includes("DNS")) {
        toast({
          title: "Cosmos Endpoint Unavailable",
          description: "The endpoint may still be initializing. Analysis will continue to retry.",
        });
      }
      scheduleNextBatchRef.current?.(variables.promptId);
    },
  });

  const activePrompts = prompts.filter((p) => p.isActive);

  const clearAllSchedules = useCallback(() => {
    const schedules = promptSchedulesRef.current;
    schedules.forEach((schedule) => {
      if (schedule.intervalId) {
        clearTimeout(schedule.intervalId);
      }
    });
    schedules.clear();
    batchInFlightRef.current.clear();
  }, []);

  const getFrameWithFallback = useCallback(async (boundingBox: BoundingBox | null): Promise<string | null> => {
    const now = Date.now();
    
    if (!boundingBox && cachedFrameRef.current) {
      const age = now - cachedFrameRef.current.timestamp;
      if (age < FRAME_CACHE_TTL_MS) {
        console.log(`[Dashboard] Reusing cached frame (${age}ms old)`);
        return cachedFrameRef.current.data;
      }
    }
    
    if (videoPlayerRef.current) {
      const frame = videoPlayerRef.current.captureFrame(boundingBox);
      if (frame) {
        if (!boundingBox) {
          cachedFrameRef.current = { data: frame, timestamp: now };
        }
        return frame;
      }
    }
    try {
      const response = await fetch("/api/test/frame");
      if (response.ok) {
        const data = await response.json();
        return data.frame;
      }
    } catch (e) {
      console.error("[Dashboard] Failed to get test frame:", e);
    }
    return null;
  }, []);

  const runBatchAnalysis = useCallback(async (prompt: Prompt) => {
    if (batchInFlightRef.current.has(prompt.id)) {
      console.log(`[BatchAnalysis] Batch already in-flight for prompt ${prompt.id}, skipping`);
      return;
    }
    
    batchInFlightRef.current.add(prompt.id);
    const frames: string[] = [];
    
    console.log(`[BatchAnalysis] Starting batch capture for prompt ${prompt.id}: ${BATCH_FRAME_COUNT} frames @ ${BATCH_INTERVAL_SECONDS}s intervals = ${BATCH_DURATION_SECONDS}s`);
    
    try {
      for (let i = 0; i < BATCH_FRAME_COUNT; i++) {
        setBatchCaptureProgress({
          promptId: prompt.id,
          framesCollected: i,
          totalFrames: BATCH_FRAME_COUNT,
        });
        
        const frame = await getFrameWithFallback(prompt.boundingBox);
        if (frame) {
          frames.push(frame);
          console.log(`[BatchAnalysis] Captured frame ${i + 1}/${BATCH_FRAME_COUNT}`);
        }
        
        if (i < BATCH_FRAME_COUNT - 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL_SECONDS * 1000));
        }
      }
      
      if (frames.length >= 2) {
        setBatchCaptureProgress({
          promptId: prompt.id,
          framesCollected: BATCH_FRAME_COUNT,
          totalFrames: BATCH_FRAME_COUNT,
        });
        
        console.log(`[BatchAnalysis] Sending ${frames.length} frames for temporal analysis over ${BATCH_DURATION_SECONDS}s (guard stays active until API completes)`);
        analyzeBatchMutation.mutate({
          frames,
          promptId: prompt.id,
          intervalSeconds: BATCH_INTERVAL_SECONDS,
          durationSeconds: BATCH_DURATION_SECONDS,
          sceneContext: sceneAgentContext || undefined,
        });
      } else {
        console.log(`[BatchAnalysis] Insufficient frames captured (${frames.length}), skipping analysis`);
        setBatchCaptureProgress(null);
        batchInFlightRef.current.delete(prompt.id);
      }
    } catch (error) {
      console.error(`[BatchAnalysis] Error during batch capture:`, error);
      setBatchCaptureProgress(null);
      batchInFlightRef.current.delete(prompt.id);
    }
  }, [getFrameWithFallback, analyzeBatchMutation, sceneAgentContext, BATCH_FRAME_COUNT, BATCH_INTERVAL_SECONDS, BATCH_DURATION_SECONDS]);

  const scheduleNextBatch = useCallback((promptId: string) => {
    const schedules = promptSchedulesRef.current;
    const currentPrompt = prompts.find(p => p.id === promptId);
    
    if (!currentPrompt || !currentPrompt.isActive || !isAnalyzing) {
      console.log(`[BatchAnalysis] Not scheduling next batch for prompt ${promptId}: inactive or analysis stopped`);
      schedules.delete(promptId);
      return;
    }
    
    const cooldownMs = currentPrompt.frequencySeconds * 1000;
    console.log(`[BatchAnalysis] Scheduling next batch for prompt ${promptId} in ${currentPrompt.frequencySeconds}s`);
    
    const timeoutId = setTimeout(() => {
      const prompt = prompts.find(p => p.id === promptId);
      if (prompt && prompt.isActive && isAnalyzing) {
        runBatchAnalysis(prompt);
      }
    }, cooldownMs);
    
    schedules.set(promptId, {
      promptId,
      frequency: currentPrompt.frequencySeconds,
      nextRunAt: Date.now() + cooldownMs,
      intervalId: timeoutId,
    });
  }, [prompts, isAnalyzing, runBatchAnalysis]);

  useEffect(() => {
    scheduleNextBatchRef.current = scheduleNextBatch;
  }, [scheduleNextBatch]);

  const schedulePrompt = useCallback((prompt: Prompt) => {
    const schedules = promptSchedulesRef.current;
    const existingSchedule = schedules.get(prompt.id);
    if (existingSchedule?.intervalId) {
      clearTimeout(existingSchedule.intervalId);
    }
    
    console.log(`[BatchAnalysis] Starting initial batch for prompt ${prompt.id}`);
    runBatchAnalysis(prompt);
    
    schedules.set(prompt.id, {
      promptId: prompt.id,
      frequency: prompt.frequencySeconds,
      nextRunAt: Date.now() + BATCH_DURATION_SECONDS * 1000,
      intervalId: null,
    });
  }, [runBatchAnalysis, BATCH_DURATION_SECONDS]);

  const startAnalysis = useCallback(() => {
    if (activePrompts.length === 0) {
      toast({
        title: "No active rules",
        description: "Create and enable at least one detection rule to start analysis.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    clearAllSchedules();

    activePrompts.forEach((prompt) => {
      schedulePrompt(prompt);
    });

    activePromptsRef.current = JSON.stringify(activePrompts.map(p => ({ id: p.id, freq: p.frequencySeconds })));

  }, [activePrompts, toast, clearAllSchedules, schedulePrompt]);

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    clearAllSchedules();
  }, [clearAllSchedules]);

  useEffect(() => {
    if (!isAnalyzing) return;

    const currentActivePromptsKey = JSON.stringify(activePrompts.map(p => ({ id: p.id, freq: p.frequencySeconds })));
    
    if (activePromptsRef.current !== currentActivePromptsKey) {
      activePromptsRef.current = currentActivePromptsKey;

      if (activePrompts.length === 0) {
        stopAnalysis();
        toast({
          title: "Analysis stopped",
          description: "No active detection rules remaining.",
        });
        return;
      }

      const schedules = promptSchedulesRef.current;
      
      const currentPromptIds = new Set(activePrompts.map(p => p.id));
      schedules.forEach((schedule, promptId) => {
        if (!currentPromptIds.has(promptId)) {
          if (schedule.intervalId) {
            clearTimeout(schedule.intervalId);
          }
          schedules.delete(promptId);
        }
      });

      activePrompts.forEach((prompt) => {
        const existingSchedule = schedules.get(prompt.id);
        if (!existingSchedule || existingSchedule.frequency !== prompt.frequencySeconds) {
          schedulePrompt(prompt);
        }
      });
    }
  }, [activePrompts, isAnalyzing, stopAnalysis, schedulePrompt, toast]);

  useEffect(() => {
    return () => {
      clearAllSchedules();
    };
  }, [clearAllSchedules]);

  const handlePromptSubmit = (data: {
    name: string;
    prompt: string;
    frequencySeconds: number;
    isActive: boolean;
    boundingBox: BoundingBox | null;
  }) => {
    if (editingPrompt) {
      updatePromptMutation.mutate({
        id: editingPrompt.id,
        ...data,
      });
    } else {
      createPromptMutation.mutate({
        ...data,
        videoSourceId: currentVideoSourceId,
      });
    }
    setEditingPrompt(null);
    setCurrentBoundingBox(null);
    setIsDrawingMode(false);
  };

  const handleEditPrompt = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setCurrentBoundingBox(prompt.boundingBox || null);
    setIsPromptFormOpen(true);
  };

  const handleDeletePrompt = (id: string) => {
    deletePromptMutation.mutate(id);
    if (selectedPrompt?.id === id) {
      setSelectedPrompt(null);
      setCurrentBoundingBox(null);
    }
  };

  const handleTogglePrompt = (id: string, isActive: boolean) => {
    updatePromptMutation.mutate({ id, isActive });
  };

  const handleSelectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setCurrentBoundingBox(prompt.boundingBox || null);
  };

  const handleViewAlertDetails = (alert: Alert) => {
    setSelectedAlert(alert);
    setIsAlertDetailOpen(true);
  };

  const handleTestPrompt = async (prompt: Prompt) => {
    setTestingPrompt(prompt);
    setTestResult(null);
    setIsTestLoading(true);
    
    try {
      const frameData = await getFrameWithFallback(prompt.boundingBox);
      if (!frameData) {
        toast({
          title: "Cannot capture frame",
          description: "Video is not ready. Please wait for it to load.",
          variant: "destructive",
        });
        setIsTestLoading(false);
        return;
      }
      
      setTestResult({
        detected: false,
        analysis: "",
        confidence: "analyzing",
        frameData,
      });
      setIsTestResultOpen(true);
      
      const response = await apiRequest("POST", "/api/analyze", {
        frameData,
        promptId: prompt.id,
        sceneContext: sceneAgentContext || undefined,
      });
      
      const result = await response.json();
      setTestResult({
        detected: result.detected,
        analysis: result.analysis,
        confidence: result.confidence,
        frameData,
      });
    } catch (error) {
      toast({
        title: "Test failed",
        description: error instanceof Error ? error.message : "Failed to test rule",
        variant: "destructive",
      });
      setIsTestResultOpen(false);
    } finally {
      setIsTestLoading(false);
    }
  };

  const startSceneAgent = async () => {
    // Configurable smart sampling parameters
    const FRAME_COUNT = 8; // Number of frames to capture
    const MAX_DURATION_SECONDS = 32; // Cap video sampling at 32 seconds
    const VISUAL_ANALYZING_DURATION = 12;

    setIsSceneAgentRunning(true);
    setSceneAgentPhase("recording");
    setSceneAgentElapsed(0);
    sceneAgentFramesRef.current = [];

    try {
      // Verify video is ready
      const initialFrame = videoPlayerRef.current?.captureFrame(null);
      if (!initialFrame) {
        toast({
          title: "Video not ready",
          description: "Please wait for the video to load before starting Scene Agent.",
          variant: "destructive",
        });
        setIsSceneAgentRunning(false);
        setSceneAgentPhase(null);
        setSceneAgentProgress("");
        return;
      }

      // Get video duration for smart sampling
      const videoDuration = videoPlayerRef.current?.getVideoDuration() || 0;
      if (videoDuration <= 0) {
        toast({
          title: "Video duration unknown",
          description: "Could not determine video length. Please try again.",
          variant: "destructive",
        });
        setIsSceneAgentRunning(false);
        setSceneAgentPhase(null);
        setSceneAgentProgress("");
        return;
      }

      // Calculate effective sampling duration (capped at MAX_DURATION_SECONDS, min 10s for schema)
      const MIN_DURATION_SECONDS = 10;
      const MIN_INTERVAL_SECONDS = 3; // Cosmos API requires intervalSeconds >= 3
      const effectiveDuration = Math.max(MIN_DURATION_SECONDS, Math.min(videoDuration, MAX_DURATION_SECONDS));
      
      // Calculate max frames allowed to maintain minimum interval
      // intervalSeconds = effectiveDuration / (frameCount - 1) >= MIN_INTERVAL_SECONDS
      // So frameCount <= (effectiveDuration / MIN_INTERVAL_SECONDS) + 1
      const maxFramesForInterval = Math.floor(effectiveDuration / MIN_INTERVAL_SECONDS) + 1;
      const frameCount = Math.max(2, Math.min(FRAME_COUNT, maxFramesForInterval));
      
      // Calculate interval between frames (evenly spaced across video)
      const intervalSeconds = effectiveDuration / (frameCount - 1);
      
      console.log(`[Scene Agent] Smart sampling: video=${videoDuration.toFixed(1)}s, effective=${effectiveDuration.toFixed(1)}s, interval=${intervalSeconds.toFixed(2)}s, frames=${frameCount}`);

      const recordingStartTime = Date.now();
      
      // Start elapsed timer immediately for UI feedback
      const elapsedInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        setSceneAgentElapsed(elapsed);
      }, 1000);

      // Wait for video to loop back to beginning for chronological sampling
      console.log(`[Scene Agent] Waiting for video loop restart...`);
      await videoPlayerRef.current?.waitForLoopRestart();
      console.log(`[Scene Agent] Video restarted, beginning frame capture`);

      // Capture frames evenly spaced across the video
      let apiPromise: Promise<Response> | null = null;
      
      for (let i = 0; i < frameCount; i++) {
        const frameData = videoPlayerRef.current?.captureFrame(currentBoundingBox);
        if (frameData) {
          sceneAgentFramesRef.current.push(frameData);
          const currentVideoTime = videoPlayerRef.current?.getCurrentTime() || 0;
          console.log(`[Scene Agent] Captured frame ${i + 1}/${frameCount} at video time ${currentVideoTime.toFixed(2)}s, size: ${Math.round(frameData.length / 1024)}KB`);
        } else {
          console.log(`[Scene Agent] Frame ${i + 1}/${frameCount} capture failed - video not ready`);
        }

        // Wait for next frame interval (except after last frame)
        if (i < frameCount - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }
      }
      
      clearInterval(elapsedInterval);
      
      // Start API call immediately after all frames captured
      if (sceneAgentFramesRef.current.length > 0) {
        apiPromise = apiRequest("POST", "/api/scene-agent/run", {
          frames: sceneAgentFramesRef.current,
          intervalSeconds: Math.round(intervalSeconds * 10) / 10, // Round to 1 decimal
          durationSeconds: Math.round(effectiveDuration),
          sceneContext: sceneAgentContext || undefined,
        });
      }

      if (sceneAgentFramesRef.current.length === 0) {
        toast({
          title: "No frames captured",
          description: "Could not capture any frames. Please ensure video is playing.",
          variant: "destructive",
        });
        setIsSceneAgentRunning(false);
        setSceneAgentPhase(null);
        setSceneAgentProgress("");
        return;
      }

      setSceneAgentPhase("analyzing");
      setSceneAgentElapsed(0);
      
      const analyzingStartTime = Date.now();
      const analyzingInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - analyzingStartTime) / 1000);
        setSceneAgentElapsed(Math.min(elapsed, VISUAL_ANALYZING_DURATION));
      }, 1000);

      if (!apiPromise) {
        apiPromise = apiRequest("POST", "/api/scene-agent/run", {
          frames: sceneAgentFramesRef.current,
          intervalSeconds: Math.round(intervalSeconds * 10) / 10,
          durationSeconds: Math.round(effectiveDuration),
          sceneContext: sceneAgentContext || undefined,
        });
      }

      const response = await apiPromise;
      clearInterval(analyzingInterval);

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Scene Agent analysis failed");
      }
      
      if (currentVideoSourceId) {
        setSceneAgentResults(prev => ({ ...prev, [currentVideoSourceId]: result }));
      }
      setIsSceneAgentModalOpen(true);
      
      toast({
        title: "Scene Agent Complete",
        description: "Temporal analysis is ready to view.",
      });
    } catch (error) {
      toast({
        title: "Scene Agent Failed",
        description: error instanceof Error ? error.message : "Analysis failed",
        variant: "destructive",
      });
    } finally {
      setIsSceneAgentRunning(false);
      setSceneAgentPhase(null);
      setSceneAgentProgress("");
    }
  };

  const alertPrompt = selectedAlert
    ? prompts.find((p) => p.id === selectedAlert.promptId) ?? null
    : null;

  const alertCountByPrompt = (promptId: string) =>
    alerts.filter((a) => a.promptId === promptId && !a.isRead).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <img src={nttDataLogo} alt="NTT DATA" className="h-8" />
            <div>
              <h1 className="text-lg font-semibold">Situational Awareness</h1>
              <p className="text-xs" style={{ color: '#76B900' }}>
                Powered by NVIDIA Cosmos Reason 2
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CosmosHealth />
            <Badge variant="outline" className="hidden sm:flex">
              <Video className="h-3 w-3 mr-1" />
              Live Feed
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container max-w-7xl mx-auto p-6">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">Video Monitor</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={isDrawingMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsDrawingMode(!isDrawingMode)}
                  className={isDrawingMode ? "" : "text-primary"}
                  data-testid="button-toggle-drawing"
                >
                  <Crosshair className="h-4 w-4 mr-2" />
                  {isDrawingMode ? "Drawing Region" : "Draw Region"}
                </Button>
                <div className="flex items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (currentSceneAgentResult && !isSceneAgentRunning) {
                        setIsSceneAgentModalOpen(true);
                      } else {
                        startSceneAgent();
                      }
                    }}
                    disabled={isSceneAgentRunning}
                    className="text-primary rounded-r-none border-r-0"
                    data-testid="button-scene-agent"
                  >
                    {isSceneAgentRunning ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4 mr-2" />
                    )}
                    {isSceneAgentRunning ? "Monitoring..." : currentSceneAgentResult ? "View Report" : "Scene Agent"}
                  </Button>
                  <Popover open={isSceneAgentSettingsOpen} onOpenChange={setIsSceneAgentSettingsOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={`rounded-l-none px-2 ${sceneAgentContext ? 'text-primary' : ''}`}
                        data-testid="button-scene-agent-settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="end">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="scene-context">Scene Context (Optional)</Label>
                          <Textarea
                            id="scene-context"
                            placeholder="Describe the scene to help focus the AI analysis. e.g., 'This is a loading dock. Pay attention to worker safety and package handling.'"
                            value={sceneAgentContext}
                            onChange={(e) => {
                              const value = e.target.value;
                              setSceneAgentContext(value);
                            }}
                            rows={4}
                            className="resize-none"
                            data-testid="textarea-scene-context"
                          />
                          <p className="text-xs text-muted-foreground">
                            This context will be used to guide the AI's analysis of the scene.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          onClick={() => {
                            saveSourceSettings({ sceneContext: sceneAgentContext });
                            setIsSceneAgentSettingsOpen(false);
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Source:</span>
              <Select value={currentVideoSourceId} onValueChange={setCurrentVideoSourceId}>
                <SelectTrigger className="w-48" data-testid="select-video-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {videoSources.map((source) => (
                    <SelectItem key={source.id} value={source.id} data-testid={`video-source-${source.id}`}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!import.meta.env.PROD && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/ogg,video/quicktime"
                    onChange={handleFileSelect}
                    className="hidden"
                    data-testid="input-video-upload"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadVideoMutation.isPending}
                    data-testid="button-upload-video"
                  >
                    {uploadVideoMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </Button>
                  {currentSource && !PROTECTED_DEMO_URLS.includes(currentSource.url) && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        if (currentVideoSourceId) {
                          deleteSourceMutation.mutate(currentVideoSourceId);
                        }
                      }}
                      disabled={deleteSourceMutation.isPending}
                      data-testid="button-delete-source"
                    >
                      {deleteSourceMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>

            <div className="relative">
              <VideoPlayer
                ref={videoPlayerRef}
                videoUrl={getVideoUrl(currentSource)}
                isPlaying={isPlaying}
                onPlayPause={() => setIsPlaying(!isPlaying)}
                onBoundingBoxChange={setCurrentBoundingBox}
                activeBoundingBox={currentBoundingBox}
                isDrawingMode={isDrawingMode}
                isAnalyzing={isAnalyzing}
                isSceneAgentRunning={isSceneAgentRunning}
                onFrameCapture={(frameData) => {
                  setQuickAnalysisFrame(frameData);
                  setIsQuickAnalysisOpen(true);
                }}
              />
              {isSceneAgentRunning && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center rounded-lg" data-testid="scene-agent-overlay">
                  {sceneAgentPhase === "recording" ? (
                    <>
                      <div className="relative mb-4">
                        <div className="h-16 w-16 rounded-full border-4 border-red-500 flex items-center justify-center animate-pulse">
                          <div className="h-4 w-4 rounded-full bg-red-500" />
                        </div>
                      </div>
                      <p className="text-white text-lg font-medium mb-2">Recording Scene</p>
                      <p className="text-white/80 text-2xl font-mono">{sceneAgentElapsed}s / 60s</p>
                      <p className="text-white/60 text-sm mt-2">Capturing temporal data...</p>
                    </>
                  ) : sceneAgentPhase === "analyzing" ? (
                    <>
                      <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                      <p className="text-white text-lg font-medium mb-2">Analyzing Footage</p>
                      <p className="text-white/80 text-sm">AI is synthesizing observations...</p>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-12 w-12 text-white animate-spin mb-4" />
                      <p className="text-white text-lg font-medium">Monitoring the situation...</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <AnalysisStatus
              isAnalyzing={isAnalyzing}
              activePromptCount={activePrompts.length}
              lastAnalysisTime={lastAnalysisTime}
              batchCaptureProgress={batchCaptureProgress}
              onToggleAnalysis={() => {
                if (isAnalyzing) {
                  stopAnalysis();
                } else {
                  startAnalysis();
                }
              }}
            />
          </div>

          <div className="space-y-6">
            <Tabs defaultValue="rules" className="w-full">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="rules" data-testid="tab-rules">
                  Rules
                </TabsTrigger>
                <TabsTrigger value="alerts" data-testid="tab-alerts" className="relative">
                  Alerts
                  {alerts.filter((a) => !a.isRead).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" />
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="rules" className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {prompts.length} detection rule{prompts.length !== 1 ? "s" : ""}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingPrompt(null);
                      setIsPromptFormOpen(true);
                    }}
                    data-testid="button-add-rule"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Rule
                  </Button>
                </div>

                <ScrollArea className="h-[500px] pr-4">
                  {promptsLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Card key={i} className="animate-pulse">
                          <CardContent className="h-24" />
                        </Card>
                      ))}
                    </div>
                  ) : prompts.length === 0 ? (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                          <Eye className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="font-medium mb-1">No Detection Rules</h3>
                        <p className="text-sm text-muted-foreground max-w-[200px] mb-4">
                          Create rules to tell the AI what to look for in the video feed.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditingPrompt(null);
                            setIsPromptFormOpen(true);
                          }}
                          data-testid="button-add-first-rule"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Create First Rule
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {[...prompts].sort((a, b) => Number(b.isActive) - Number(a.isActive)).map((prompt) => (
                        <PromptCard
                          key={prompt.id}
                          prompt={prompt}
                          onToggle={handleTogglePrompt}
                          onEdit={handleEditPrompt}
                          onDelete={handleDeletePrompt}
                          onSelect={handleSelectPrompt}
                          onTest={handleTestPrompt}
                          isSelected={selectedPrompt?.id === prompt.id}
                          alertCount={alertCountByPrompt(prompt.id)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="alerts" className="mt-4">
                <AlertList
                  alerts={alerts}
                  prompts={prompts}
                  onMarkAsRead={(id) => markAlertReadMutation.mutate(id)}
                  onViewDetails={handleViewAlertDetails}
                  onClearAll={() => clearAlertsMutation.mutate()}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      <PromptForm
        open={isPromptFormOpen}
        onOpenChange={setIsPromptFormOpen}
        onSubmit={handlePromptSubmit}
        editPrompt={editingPrompt}
        boundingBox={currentBoundingBox}
      />

      <AlertDetailModal
        alert={selectedAlert}
        prompt={alertPrompt}
        open={isAlertDetailOpen}
        onOpenChange={setIsAlertDetailOpen}
      />

      <Dialog open={isTestResultOpen} onOpenChange={setIsTestResultOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-test-result">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {testResult?.confidence === "analyzing" ? "Frame Captured" : "Test Result"}: {testingPrompt?.name}
            </DialogTitle>
          </DialogHeader>
          
          {testResult ? (
            <div className="space-y-4">
              {testResult.frameData && (
                <div className="rounded-md overflow-hidden border">
                  <img 
                    src={testResult.frameData} 
                    alt="Captured frame" 
                    className="w-full h-auto"
                    data-testid="img-test-frame"
                  />
                </div>
              )}
              
              {testResult.confidence === "analyzing" ? (
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium">Analyzing frame with Cosmos AI...</span>
                </div>
              ) : (
                <>
                  <div className={`flex items-center gap-2 p-3 rounded-md ${
                    testResult.detected 
                      ? "bg-destructive/10 text-destructive" 
                      : "bg-green-500/10 text-green-600 dark:text-green-400"
                  }`}>
                    {testResult.detected ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <XCircle className="h-5 w-5" />
                    )}
                    <span className="font-medium">
                      {testResult.detected ? "Condition Detected" : "No Detection"}
                    </span>
                    <Badge variant="outline" className="ml-auto">
                      {testResult.confidence} confidence
                    </Badge>
                  </div>
                  
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">AI Analysis</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {testResult.analysis}
                    </p>
                  </div>
                </>
              )}
              
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Detection Rule</h4>
                <p className="text-sm text-muted-foreground">
                  {testingPrompt?.prompt}
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <SceneAgentModal
        open={isSceneAgentModalOpen}
        onOpenChange={setIsSceneAgentModalOpen}
        result={currentSceneAgentResult}
        onRefresh={startSceneAgent}
        isRefreshing={isSceneAgentRunning}
      />

      <QuickAnalysisModal
        isOpen={isQuickAnalysisOpen}
        onClose={() => {
          setIsQuickAnalysisOpen(false);
          setQuickAnalysisFrame(null);
        }}
        frameData={quickAnalysisFrame}
        sceneContext={sceneAgentContext}
      />

      <Dialog open={isUploadDialogOpen} onOpenChange={(open) => !open && handleUploadCancel()}>
        <DialogContent className="max-w-md" data-testid="dialog-upload-name">
          <DialogHeader>
            <DialogTitle>Name Your Video Source</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Enter a friendly name for this video source. This will be displayed in the source dropdown.
          </p>
          <Input
            value={uploadFileName}
            onChange={(e) => setUploadFileName(e.target.value)}
            placeholder="e.g., Front Entrance Camera"
            data-testid="input-upload-name"
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={handleUploadCancel} data-testid="button-upload-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleUploadConfirm} 
              disabled={!uploadFileName.trim() || uploadVideoMutation.isPending}
              data-testid="button-upload-confirm"
            >
              {uploadVideoMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
