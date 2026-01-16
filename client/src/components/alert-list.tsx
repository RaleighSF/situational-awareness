import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Check, Eye, Bell, BellOff } from "lucide-react";
import type { Alert, Prompt } from "@shared/schema";

interface AlertListProps {
  alerts: Alert[];
  prompts: Prompt[];
  onMarkAsRead: (id: string) => void;
  onViewDetails: (alert: Alert) => void;
  onClearAll: () => void;
}

export function AlertList({
  alerts,
  prompts,
  onMarkAsRead,
  onViewDetails,
  onClearAll,
}: AlertListProps) {
  const unreadCount = alerts.filter((a) => !a.isRead).length;

  const getPromptName = (promptId: string | null) => {
    if (!promptId) return "Unknown";
    const prompt = prompts.find((p) => p.id === promptId);
    return prompt?.name ?? "Unknown";
  };

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <BellOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-medium mb-1">No Alerts Yet</h3>
          <p className="text-sm text-muted-foreground max-w-[200px]">
            When the AI detects something matching your rules, alerts will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 space-y-0">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Alerts</CardTitle>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {unreadCount} new
            </Badge>
          )}
        </div>
        {alerts.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="text-xs"
            data-testid="button-clear-alerts"
          >
            Clear All
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="space-y-0">
            {alerts.map((alert, index) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-4 border-b last:border-0 ${
                  !alert.isRead ? "bg-accent/30" : ""
                }`}
                data-testid={`alert-item-${alert.id}`}
              >
                <div className={`mt-0.5 ${!alert.isRead ? "alert-pulse" : ""}`}>
                  <AlertTriangle className={`h-4 w-4 ${!alert.isRead ? "text-destructive" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {getPromptName(alert.promptId)}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {alert.timestamp
                        ? formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })
                        : "just now"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {alert.analysisResult}
                  </p>
                  {alert.confidence && (
                    <Badge variant="secondary" className="text-xs">
                      Confidence: {alert.confidence}
                    </Badge>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {!alert.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => onMarkAsRead(alert.id)}
                        data-testid={`button-mark-read-${alert.id}`}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Mark Read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onViewDetails(alert)}
                      data-testid={`button-view-alert-${alert.id}`}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Details
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
