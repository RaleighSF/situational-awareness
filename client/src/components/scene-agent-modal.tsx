import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Clock, TrendingUp, Repeat, AlertTriangle, FileText } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="scene-agent-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Scene Agent Analysis
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Analyzed {result.frameCount} frames from{" "}
                  {new Date(result.startTime).toLocaleTimeString()} to{" "}
                  {new Date(result.endTime).toLocaleTimeString()}
                </p>
                <Separator className="my-3" />
                <p className="text-sm" data-testid="scene-agent-narrative">
                  {result.synthesis.narrative}
                </p>
              </CardContent>
            </Card>

            {result.synthesis.changes.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    Changes Detected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {result.synthesis.changes.map((change, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-blue-500 mt-1">•</span>
                        <span>{change}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {result.synthesis.persistent.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-green-500" />
                    Persistent Elements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {result.synthesis.persistent.map((item, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-green-500 mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {result.synthesis.anomalies.length > 0 && (
              <Card className="border-orange-200 dark:border-orange-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    Anomalies Detected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {result.synthesis.anomalies.map((anomaly, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>{anomaly}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Timeline Observations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.observations.map((obs) => (
                    <div key={obs.index} className="border-l-2 border-muted pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          T+{obs.timestampOffset}s
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {obs.observation}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
