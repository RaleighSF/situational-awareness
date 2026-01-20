import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, Activity, Cpu, Eye, Clock, Layers } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface BatchCaptureProgress {
  promptId: string;
  framesCollected: number;
  totalFrames: number;
}

interface AnalysisStatusProps {
  isAnalyzing: boolean;
  activePromptCount: number;
  lastAnalysisTime: Date | null;
  onToggleAnalysis: () => void;
  batchCaptureProgress?: BatchCaptureProgress | null;
}

export function AnalysisStatus({
  isAnalyzing,
  activePromptCount,
  lastAnalysisTime,
  onToggleAnalysis,
  batchCaptureProgress,
}: AnalysisStatusProps) {
  const isCapturing = batchCaptureProgress && batchCaptureProgress.framesCollected < batchCaptureProgress.totalFrames;
  const isSynthesizing = batchCaptureProgress && batchCaptureProgress.framesCollected >= batchCaptureProgress.totalFrames;
  const capturePercent = batchCaptureProgress 
    ? (batchCaptureProgress.framesCollected / batchCaptureProgress.totalFrames) * 100 
    : 0;

  return (
    <Card className={isAnalyzing ? "animate-glow-breathe-green border-green-500/30" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`relative ${isAnalyzing ? "animate-pulse" : ""}`}>
              <Cpu className={`h-5 w-5 ${isAnalyzing ? "text-green-500" : "text-muted-foreground"}`} />
              {isAnalyzing && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-sm">AI Analysis</h3>
              <p className="text-xs text-muted-foreground">
                {isSynthesizing 
                  ? "Analyzing temporal patterns..." 
                  : isCapturing 
                    ? `Capturing frames (${batchCaptureProgress?.framesCollected}/${batchCaptureProgress?.totalFrames})` 
                    : isAnalyzing 
                      ? "Monitoring video feed" 
                      : "Paused"}
              </p>
            </div>
          </div>
          <Button
            variant={isAnalyzing ? "secondary" : "default"}
            size="sm"
            onClick={onToggleAnalysis}
            data-testid="button-toggle-analysis"
          >
            {isAnalyzing ? (
              <>
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                Start
              </>
            )}
          </Button>
        </div>

        {batchCaptureProgress && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-3 w-3 text-blue-500" />
              <span className="text-xs text-muted-foreground">
                {isSynthesizing ? "Temporal Analysis" : "Batch Capture"}
              </span>
            </div>
            <Progress 
              value={isSynthesizing ? 100 : capturePercent} 
              className={`h-1.5 ${isSynthesizing ? "animate-pulse" : ""}`}
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
            <Eye className="h-4 w-4 text-muted-foreground mb-1" />
            <span className="text-lg font-semibold">{activePromptCount}</span>
            <span className="text-xs text-muted-foreground">Active Rules</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
            <Activity className="h-4 w-4 text-muted-foreground mb-1" />
            <Badge variant={isAnalyzing ? "default" : "secondary"} className="text-xs">
              {isSynthesizing ? "Analyzing" : isCapturing ? "Capturing" : isAnalyzing ? "Live" : "Idle"}
            </Badge>
            <span className="text-xs text-muted-foreground mt-1">Status</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
            <Clock className="h-4 w-4 text-muted-foreground mb-1" />
            <span className="text-xs font-medium">
              {lastAnalysisTime
                ? lastAnalysisTime.toLocaleTimeString()
                : "--:--"}
            </span>
            <span className="text-xs text-muted-foreground">Last Check</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
