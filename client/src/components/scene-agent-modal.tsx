import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Clock, TrendingUp, AlertTriangle, AlertOctagon, FileText, Activity } from "lucide-react";
import type { SceneAgentResult } from "@shared/schema";

interface SceneAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SceneAgentResult | null;
}

export function SceneAgentModal({
  open,
  onOpenChange,
  result,
}: SceneAgentModalProps) {
  if (!result) return null;

  const synthesis = result.synthesis;
  const hasValidSynthesis = synthesis !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="scene-agent-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Scene Agent Analysis
          </DialogTitle>
          <DialogDescription>
            Temporal analysis of {result.frameCount} frames
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Summary
                  </span>
                  {hasValidSynthesis && (
                    <Badge 
                      variant={synthesis.confidence === "HIGH" ? "default" : "secondary"}
                      data-testid="confidence-badge"
                    >
                      {synthesis.confidence} Confidence
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Analyzed {result.frameCount} frames from{" "}
                  {new Date(result.startTime).toLocaleTimeString()} to{" "}
                  {new Date(result.endTime).toLocaleTimeString()}
                </p>
                <Separator className="my-3" />
                <p className="text-sm" data-testid="scene-agent-summary">
                  {hasValidSynthesis ? synthesis.summary : result.rawText || "Analysis could not generate a structured summary."}
                </p>
              </CardContent>
            </Card>

            {hasValidSynthesis && synthesis.events.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    Events Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {synthesis.events.map((event, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <Badge variant="outline" className="text-xs shrink-0">
                          T+{event.t}s
                        </Badge>
                        <span>{event.description}</span>
                        {event.type && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {event.type}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {hasValidSynthesis && synthesis.anomalies.length > 0 && (
              <Card className="border-orange-200 dark:border-orange-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    Anomalies Detected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {synthesis.anomalies.map((anomaly, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>{anomaly}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {hasValidSynthesis && synthesis.escalations.length > 0 && (
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertOctagon className="h-4 w-4 text-red-500" />
                    Escalations Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {synthesis.escalations.map((escalation, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-red-500 mt-1">•</span>
                        <span>{escalation}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Frame Observations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.observations.map((obs, index) => (
                    <div key={index} className="border-l-2 border-muted pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          T+{obs.t}s
                        </Badge>
                        {obs.confidence && (
                          <Badge variant="outline" className="text-xs">
                            {obs.confidence}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {obs.text}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {result.rawText && !hasValidSynthesis && (
              <Card className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Raw Analysis Output
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                    {result.rawText}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
