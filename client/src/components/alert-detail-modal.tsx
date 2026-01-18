import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Clock, Target, AlertCircle, FileText, Lightbulb } from "lucide-react";
import type { Alert, Prompt } from "@shared/schema";

interface AlertDetailModalProps {
  alert: Alert | null;
  prompt: Prompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseAnalysisResult(raw: string) {
  // Normalize: insert line breaks before headers for consistent parsing
  const normalized = raw.replace(/\s*(DETECTED|CONFIDENCE|SIGNALS|ANALYSIS|RECOMMENDED_ACTIONS):/gi, '\n$1:');
  
  const extractSection = (text: string, header: string): string => {
    const regex = new RegExp(`${header}:\\s*([\\s\\S]*?)(?=\\n(?:DETECTED|CONFIDENCE|SIGNALS|ANALYSIS|RECOMMENDED_ACTIONS):|$)`, 'i');
    const match = text.match(regex);
    return match?.[1]?.trim() || "";
  };

  const signals = extractSection(normalized, 'SIGNALS');
  const analysis = extractSection(normalized, 'ANALYSIS');
  const actions = extractSection(normalized, 'RECOMMENDED_ACTIONS');

  return { signals, analysis, actions };
}

export function AlertDetailModal({
  alert,
  prompt,
  open,
  onOpenChange,
}: AlertDetailModalProps) {
  if (!alert) return null;

  const parsed = parseAnalysisResult(alert.analysisResult || "");
  const hasStructuredContent = parsed.signals || parsed.analysis || parsed.actions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

          <div className="flex items-center gap-4 text-sm">
            {alert.confidence && (
              <Badge variant="outline">
                {alert.confidence} confidence
              </Badge>
            )}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>
                Check interval: {prompt?.frequencySeconds ?? 60}s
              </span>
            </div>
          </div>

          <Separator />

          {hasStructuredContent ? (
            <div className="space-y-4">
              {parsed.signals && (
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    Signals
                  </h4>
                  <p className="text-sm bg-yellow-500/10 p-3 rounded-md border border-yellow-500/20">
                    {parsed.signals}
                  </p>
                </div>
              )}

              {parsed.analysis && (
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-blue-500" />
                    Analysis
                  </h4>
                  <p className="text-sm bg-blue-500/10 p-3 rounded-md border border-blue-500/20">
                    {parsed.analysis}
                  </p>
                </div>
              )}

              {parsed.actions && (
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                    <Lightbulb className="h-4 w-4 text-green-500" />
                    Recommended Actions
                  </h4>
                  <p className="text-sm bg-green-500/10 p-3 rounded-md border border-green-500/20">
                    {parsed.actions}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h4 className="text-sm font-medium mb-2">Analysis</h4>
              <p className="text-sm bg-accent/30 p-3 rounded-md">
                {alert.analysisResult}
              </p>
            </div>
          )}

          <Separator />

          <div>
            <h4 className="text-sm font-medium flex items-center gap-2 mb-2 text-muted-foreground">
              <Target className="h-4 w-4" />
              Detection Rule
            </h4>
            <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
              {prompt?.prompt ?? "Unknown prompt"}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
