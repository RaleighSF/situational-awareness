import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { VideoPlayer, VideoPlayerRef } from "@/components/video-player";
import { PromptCard } from "@/components/prompt-card";
import { PromptForm } from "@/components/prompt-form";
import { AlertList } from "@/components/alert-list";
import { AlertDetailModal } from "@/components/alert-detail-modal";
import { AnalysisStatus } from "@/components/analysis-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Video,
  Shield,
  Crosshair,
  Eye,
} from "lucide-react";
import type { Prompt, Alert, BoundingBox } from "@shared/schema";

const DEFAULT_VIDEO_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

interface PromptSchedule {
  promptId: string;
  frequency: number;
  nextRunAt: number;
  intervalId: NodeJS.Timeout | null;
}

export default function Dashboard() {
  const { toast } = useToast();
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
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
  const [nextAnalysisIn, setNextAnalysisIn] = useState<number | null>(null);
  const promptSchedulesRef = useRef<Map<string, PromptSchedule>>(new Map());
  const activePromptsRef = useRef<string>("");

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
      if (error.message.includes("unavailable") || error.message.includes("preview")) {
        toast({
          title: "AI Model Unavailable",
          description: "The Cosmos Reason 2 model may still be in preview. Analysis will continue to retry.",
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

  const schedulePrompt = useCallback((prompt: Prompt) => {
    if (!videoPlayerRef.current) return;

    const frameData = videoPlayerRef.current.captureFrame(prompt.boundingBox);
    if (frameData) {
      analyzeFrameMutation.mutate({
        frameData,
        promptId: prompt.id,
      });
    }

    const schedules = promptSchedulesRef.current;
    const existingSchedule = schedules.get(prompt.id);
    if (existingSchedule?.intervalId) {
      clearInterval(existingSchedule.intervalId);
    }

    const intervalId = setInterval(() => {
      if (!videoPlayerRef.current) return;
      const currentPrompt = prompts.find(p => p.id === prompt.id);
      if (!currentPrompt || !currentPrompt.isActive) {
        const schedule = schedules.get(prompt.id);
        if (schedule?.intervalId) {
          clearInterval(schedule.intervalId);
          schedules.delete(prompt.id);
        }
        return;
      }
      const frame = videoPlayerRef.current.captureFrame(currentPrompt.boundingBox);
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
  }, [analyzeFrameMutation, prompts]);

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

    if (activePrompts.length > 0) {
      const minFrequency = Math.min(...activePrompts.map((p) => p.frequencySeconds));
      setNextAnalysisIn(minFrequency);
    }
  }, [activePrompts, toast, clearAllSchedules, schedulePrompt]);

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    setNextAnalysisIn(null);
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
    if (!isAnalyzing || activePrompts.length === 0) return;

    const updateCountdown = () => {
      const now = Date.now();
      const schedules = promptSchedulesRef.current;
      let minSecondsUntilNext = Infinity;

      activePrompts.forEach((prompt) => {
        const schedule = schedules.get(prompt.id);
        if (schedule) {
          const secondsUntilNext = Math.max(0, Math.ceil((schedule.nextRunAt - now) / 1000));
          if (secondsUntilNext < minSecondsUntilNext) {
            minSecondsUntilNext = secondsUntilNext;
          }
        }
      });

      setNextAnalysisIn(minSecondsUntilNext === Infinity ? null : minSecondsUntilNext);
    };

    const countdownInterval = setInterval(updateCountdown, 1000);
    updateCountdown();

    return () => clearInterval(countdownInterval);
  }, [isAnalyzing, activePrompts]);

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
      createPromptMutation.mutate(data);
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
              <Shield className="h-5 w-5 text-primary-foreground" />
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
              <Button
                variant={isDrawingMode ? "default" : "outline"}
                size="sm"
                onClick={() => setIsDrawingMode(!isDrawingMode)}
                data-testid="button-toggle-drawing"
              >
                <Crosshair className="h-4 w-4 mr-2" />
                {isDrawingMode ? "Drawing Region" : "Draw Region"}
              </Button>
            </div>

            <VideoPlayer
              ref={videoPlayerRef}
              videoUrl={DEFAULT_VIDEO_URL}
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              onBoundingBoxChange={setCurrentBoundingBox}
              activeBoundingBox={currentBoundingBox}
              isDrawingMode={isDrawingMode}
            />

            <AnalysisStatus
              isAnalyzing={isAnalyzing}
              activePromptCount={activePrompts.length}
              lastAnalysisTime={lastAnalysisTime}
              nextAnalysisIn={nextAnalysisIn}
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
                      {prompts.map((prompt) => (
                        <PromptCard
                          key={prompt.id}
                          prompt={prompt}
                          onToggle={handleTogglePrompt}
                          onEdit={handleEditPrompt}
                          onDelete={handleDeletePrompt}
                          onSelect={handleSelectPrompt}
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
    </div>
  );
}
