import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, Activity, Cpu, Eye, Clock } from "lucide-react";

interface AnalysisStatusProps {
  isAnalyzing: boolean;
  activePromptCount: number;
  lastAnalysisTime: Date | null;
  nextAnalysisIn: number | null;
  minFrequency: number;
  onToggleAnalysis: () => void;
}

export function AnalysisStatus({
  isAnalyzing,
  activePromptCount,
  lastAnalysisTime,
  nextAnalysisIn,
  minFrequency,
  onToggleAnalysis,
}: AnalysisStatusProps) {
  const progressPercent = nextAnalysisIn !== null && minFrequency > 0
    ? Math.max(0, 100 - (nextAnalysisIn / minFrequency) * 100)
    : 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`relative ${isAnalyzing ? "animate-pulse" : ""}`}>
              <Cpu className={`h-5 w-5 ${isAnalyzing ? "text-primary" : "text-muted-foreground"}`} />
              {isAnalyzing && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-sm">AI Analysis</h3>
              <p className="text-xs text-muted-foreground">
                {isAnalyzing ? "Processing video feed" : "Paused"}
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

        {isAnalyzing && nextAnalysisIn !== null && activePromptCount === 1 && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Next analysis</span>
              <span className="font-mono">{nextAnalysisIn}s</span>
            </div>
            <Progress value={progressPercent} className="h-1" />
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
              {isAnalyzing ? "Live" : "Idle"}
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
