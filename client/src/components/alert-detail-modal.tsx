import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Clock, Target } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>{prompt?.name ?? "Alert Details"}</DialogTitle>
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

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {alert.confidence && (
                <Badge variant="outline">
                  Confidence: {alert.confidence}
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
