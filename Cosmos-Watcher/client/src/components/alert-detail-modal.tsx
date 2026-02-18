import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Clock, Target, Layers, Timer } from "lucide-react";
import type { Alert, Prompt } from "@shared/schema";

interface AlertDetailModalProps {
  alert: Alert | null;
  prompt: Prompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertDetailModal({
  alert,
  prompt,
  open,
  onOpenChange,
}: AlertDetailModalProps) {
  if (!alert) return null;

  const batchMeta = alert.batchMeta as {
    mode?: string;
    frameCount?: number;
    intervalSeconds?: number;
    durationSeconds?: number;
    observations?: { t: number; text: string }[];
    synthesis?: string;
  } | null;

  const isBatchAlert = batchMeta?.mode === "batch";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {prompt?.name ?? "Alert Details"}
                {isBatchAlert && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    <Layers className="h-3 w-3 mr-1" />
                    Temporal
                  </Badge>
                )}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {alert.timestamp
                  ? format(new Date(alert.timestamp), "PPpp")
                  : "Unknown time"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {alert.frameData && (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <img
                src={alert.frameData}
                alt="Alert frame capture"
                className="w-full h-full object-contain"
              />
              {isBatchAlert && (
                <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  {batchMeta?.frameCount} frames / {batchMeta?.durationSeconds}s
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                <Target className="h-4 w-4" />
                Detection Rule
              </h4>
              <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                {prompt?.prompt ?? "Unknown prompt"}
              </p>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-medium mb-2">Analysis Result</h4>
              <p className="text-sm bg-accent/30 p-3 rounded-md">
                {alert.analysisResult}
              </p>
            </div>

            {isBatchAlert && batchMeta?.observations && batchMeta.observations.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Temporal Timeline ({batchMeta.frameCount} frames over {batchMeta.durationSeconds}s)
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {batchMeta.observations.map((obs, idx) => (
                      <div 
                        key={idx} 
                        className="flex gap-3 text-sm bg-muted/30 p-2 rounded-md"
                      >
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {obs.t}s
                        </Badge>
                        <p className="text-muted-foreground">{obs.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              {alert.confidence && (
                <Badge variant="outline">
                  Confidence: {alert.confidence}
                </Badge>
              )}
              {isBatchAlert && (
                <Badge variant="secondary" className="text-xs">
                  <Layers className="h-3 w-3 mr-1" />
                  {batchMeta?.frameCount} frames @ {batchMeta?.intervalSeconds}s intervals
                </Badge>
              )}
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  Check interval: {prompt?.frequencySeconds ?? 60}s
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
