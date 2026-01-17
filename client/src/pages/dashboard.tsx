import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { VideoPlayer, VideoPlayerRef } from "@/components/video-player";
import { PromptCard } from "@/components/prompt-card";
import { PromptForm } from "@/components/prompt-form";
import { AlertList } from "@/components/alert-list";
import { AlertDetailModal } from "@/components/alert-detail-modal";
import { AnalysisStatus } from "@/components/analysis-status";
import { SceneAgentModal } from "@/components/scene-agent-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { SiNvidia } from "react-icons/si";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Prompt, Alert, BoundingBox, SceneAgentResult } from "@shared/schema";

const VIDEO_SOURCES = [
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

const getVideoUrl = (sourceId: string) => {
  const source = VIDEO_SOURCES.find(s => s.id === sourceId);
  if (!source) return "";
  if (source.url.startsWith("/")) {
    return source.url;
  }
  return `/api/video/proxy?url=${encodeURIComponent(source.url)}`;
};

interface PromptSchedule {
  promptId: string;
  frequency: number;
  nextRunAt: number;
  intervalId: NodeJS.Timeout | null;
}

export default function Dashboard() {
  const { toast } = useToast();
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
  const [currentVideoSource, setCurrentVideoSource] = useState("loading-dock");
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
  const [sceneAgentResult, setSceneAgentResult] = useState<SceneAgentResult | null>(null);
  const [isSceneAgentModalOpen, setIsSceneAgentModalOpen] = useState(false);
  const sceneAgentFramesRef = useRef<string[]>([]);

  const { data: prompts = [], isLoading: promptsLoading } = useQuery<Prompt[]>({
    queryKey: ["/api/prompts"],
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: isAnalyzing ? 5000 : false,
  });

  const createPromptMutation = useMutation({
    mutationFn: async (data: Omit<Prompt, "id">) => {
      const res = await apiRequest("POST", "/api/prompts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const clearAlertsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/alerts");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "All alerts cleared" });
    },
  });

  const analyzeFrameMutation = useMutation({
    mutationFn: async (data: { frameData: string; promptId: string }) => {
      const res = await apiRequest("POST", "/api/analyze", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Analysis failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.alertCreated) {
        queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
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

  const activePrompts = prompts.filter((p) => p.isActive);

  const clearAllSchedules = useCallback(() => {
    const schedules = promptSchedulesRef.current;
    schedules.forEach((schedule) => {
      if (schedule.intervalId) {
        clearInterval(schedule.intervalId);
      }
    });
    schedules.clear();
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

  const schedulePrompt = useCallback((prompt: Prompt) => {
    const runAnalysis = async () => {
      const frameData = await getFrameWithFallback(prompt.boundingBox);
      if (frameData) {
        analyzeFrameMutation.mutate({
          frameData,
          promptId: prompt.id,
        });
      }
    };

    runAnalysis();

    const schedules = promptSchedulesRef.current;
    const existingSchedule = schedules.get(prompt.id);
    if (existingSchedule?.intervalId) {
      clearInterval(existingSchedule.intervalId);
    }

    const intervalId = setInterval(async () => {
      const currentPrompt = prompts.find(p => p.id === prompt.id);
      if (!currentPrompt || !currentPrompt.isActive) {
        const schedule = schedules.get(prompt.id);
        if (schedule?.intervalId) {
          clearInterval(schedule.intervalId);
          schedules.delete(prompt.id);
        }
        return;
      }
      const frame = await getFrameWithFallback(currentPrompt.boundingBox);
      if (frame) {
        analyzeFrameMutation.mutate({
          frameData: frame,
          promptId: currentPrompt.id,
        });
      }
      const sched = schedules.get(prompt.id);
      if (sched) {
        sched.nextRunAt = Date.now() + currentPrompt.frequencySeconds * 1000;
      }
    }, prompt.frequencySeconds * 1000);

    schedules.set(prompt.id, {
      promptId: prompt.id,
      frequency: prompt.frequencySeconds,
      nextRunAt: Date.now() + prompt.frequencySeconds * 1000,
      intervalId,
    });
  }, [analyzeFrameMutation, prompts, getFrameWithFallback]);

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
            clearInterval(schedule.intervalId);
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
        videoSourceId: null,
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
    const durationSeconds = 20;
    const intervalSeconds = 4;
    const frameCount = Math.floor(durationSeconds / intervalSeconds) + 1;

    setIsSceneAgentRunning(true);
    setSceneAgentProgress(`Watching for ${durationSeconds} seconds...`);
    sceneAgentFramesRef.current = [];

    try {
      const initialFrame = videoPlayerRef.current?.captureFrame(null);
      if (!initialFrame) {
        toast({
          title: "Video not ready",
          description: "Please wait for the video to load before starting Scene Agent.",
          variant: "destructive",
        });
        setIsSceneAgentRunning(false);
        setSceneAgentProgress("");
        return;
      }

      for (let i = 0; i < frameCount; i++) {
        const secondsElapsed = i * intervalSeconds;
        const secondsRemaining = durationSeconds - secondsElapsed;
        setSceneAgentProgress(secondsRemaining > 0 ? `${secondsRemaining} seconds remaining...` : `Finishing observation...`);
        
        const frameData = videoPlayerRef.current?.captureFrame(currentBoundingBox);
        if (frameData) {
          sceneAgentFramesRef.current.push(frameData);
          console.log(`[Scene Agent] Captured frame ${i + 1}/${frameCount}, size: ${Math.round(frameData.length / 1024)}KB`);
        } else {
          console.log(`[Scene Agent] Frame ${i + 1}/${frameCount} capture failed - video not ready`);
        }

        if (i < frameCount - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }
      }

      if (sceneAgentFramesRef.current.length === 0) {
        toast({
          title: "No frames captured",
          description: "Could not capture any frames. Please ensure video is playing.",
          variant: "destructive",
        });
        setIsSceneAgentRunning(false);
        setSceneAgentProgress("");
        return;
      }

      setSceneAgentProgress(`Processing observations...`);

      const response = await apiRequest("POST", "/api/scene-agent/run", {
        frames: sceneAgentFramesRef.current,
        intervalSeconds,
        durationSeconds,
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Scene Agent analysis failed");
      }
      
      setSceneAgentResult(result);
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
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
              <SiNvidia className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Situational Awareness</h1>
              <p className="text-xs text-muted-foreground">
                Powered by NVIDIA Cosmos Reason 2
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startSceneAgent}
                  disabled={isSceneAgentRunning}
                  className="text-primary"
                  data-testid="button-scene-agent"
                >
                  {isSceneAgentRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Bot className="h-4 w-4 mr-2" />
                  )}
                  {isSceneAgentRunning ? "Monitoring..." : "Scene Agent"}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-muted-foreground">Source:</span>
              <Select value={currentVideoSource} onValueChange={setCurrentVideoSource}>
                <SelectTrigger className="w-48" data-testid="select-video-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_SOURCES.map((source) => (
                    <SelectItem key={source.id} value={source.id} data-testid={`video-source-${source.id}`}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <VideoPlayer
                ref={videoPlayerRef}
                videoUrl={getVideoUrl(currentVideoSource)}
                isPlaying={isPlaying}
                onPlayPause={() => setIsPlaying(!isPlaying)}
                onBoundingBoxChange={setCurrentBoundingBox}
                activeBoundingBox={currentBoundingBox}
                isDrawingMode={isDrawingMode}
                isAnalyzing={isAnalyzing}
              />
              {isSceneAgentRunning && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center rounded-lg" data-testid="scene-agent-overlay">
                  <Loader2 className="h-12 w-12 text-white animate-spin mb-4" />
                  <p className="text-white text-lg font-medium">Monitoring the situation...</p>
                </div>
              )}
            </div>

            <AnalysisStatus
              isAnalyzing={isAnalyzing}
              activePromptCount={activePrompts.length}
              lastAnalysisTime={lastAnalysisTime}
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
        result={sceneAgentResult}
      />
    </div>
  );
}
