import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, AlertTriangle, AlertOctagon, ChevronDown, TrendingUp, Repeat } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

  const formatTimeRange = () => {
    const start = new Date(result.startTime);
    const end = new Date(result.endTime);
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    return `${result.frameCount} frames over ${duration} seconds`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden" data-testid="scene-agent-modal">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-xl font-semibold">
              Temporal Analysis
            </DialogTitle>
            {hasValidSynthesis && (
              <Badge 
                variant={synthesis.confidence >= 0.7 ? "default" : "secondary"}
                className="text-xs"
                data-testid="confidence-badge"
              >
                {Math.round(synthesis.confidence * 100)}% Confidence
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {formatTimeRange()}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-100px)]">
          <div className="px-6 pb-6 space-y-6">
            {hasValidSynthesis && synthesis.summary && (
              <div data-testid="scene-agent-summary">
                <p className="text-base leading-relaxed">
                  {synthesis.summary}
                </p>
              </div>
            )}

            {hasValidSynthesis && (synthesis.changes.length > 0 || synthesis.persistent.length > 0) && (
              <>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {synthesis.changes.length > 0 && (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-4">
                      <div className="flex items-center gap-2 mb-3" data-testid="section-changes">
                        <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <h3 className="font-medium text-blue-900 dark:text-blue-100">What Changed</h3>
                      </div>
                      <ul className="space-y-2">
                        {synthesis.changes.map((item, i) => (
                          <li key={i} className="text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2" data-testid={`change-item-${i}`}>
                            <span className="text-blue-500 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {synthesis.persistent.length > 0 && (
                    <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4">
                      <div className="flex items-center gap-2 mb-3" data-testid="section-persistent">
                        <Repeat className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <h3 className="font-medium text-green-900 dark:text-green-100">What Stayed the Same</h3>
                      </div>
                      <ul className="space-y-2">
                        {synthesis.persistent.map((item, i) => (
                          <li key={i} className="text-sm text-green-800 dark:text-green-200 flex items-start gap-2" data-testid={`persistent-item-${i}`}>
                            <span className="text-green-500 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}

            {hasValidSynthesis && (synthesis.anomalies.length > 0 || synthesis.escalations.length > 0) && (
              <>
                <Separator />
                <div className="space-y-4">
                  {synthesis.escalations.length > 0 && (
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertOctagon className="h-4 w-4 text-red-600 dark:text-red-400" />
                        <h3 className="font-medium text-red-900 dark:text-red-100">Requires Attention</h3>
                      </div>
                      <ul className="space-y-2">
                        {synthesis.escalations.map((item, i) => (
                          <li key={i} className="text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
                            <span className="text-red-500 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {synthesis.anomalies.length > 0 && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <h3 className="font-medium text-amber-900 dark:text-amber-100">Notable Changes</h3>
                      </div>
                      <ul className="space-y-2">
                        {synthesis.anomalies.map((item, i) => (
                          <li key={i} className="text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                            <span className="text-amber-500 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}


            {hasValidSynthesis && synthesis.events.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-4" data-testid="section-timeline">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Timeline</h3>
                  </div>
                  <div className="relative">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                    <div className="space-y-4">
                      {synthesis.events.map((event, index) => {
                        const matchingObs = result.observations.find(o => o.t === event.t);
                        return (
                          <div key={index} className="relative pl-6" data-testid={`timeline-entry-${index}`}>
                            <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full bg-background border-2 border-muted-foreground" />
                            <div>
                              <span className="text-xs font-medium text-foreground">
                                T+{event.t}s
                              </span>
                              <p className="text-sm text-muted-foreground mt-1">
                                {event.description}
                              </p>
                              {matchingObs && (
                                <Collapsible>
                                  <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground mt-2 hover-elevate">
                                    <ChevronDown className="h-3 w-3" />
                                    <span>Frame details</span>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <p className="text-xs text-muted-foreground/70 mt-2 pl-4 border-l border-border whitespace-pre-line">
                                      {matchingObs.text}
                                    </p>
                                  </CollapsibleContent>
                                </Collapsible>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}

            {!hasValidSynthesis && (
              <div className="text-center py-8 text-muted-foreground">
                <p>Analysis could not generate structured results.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
