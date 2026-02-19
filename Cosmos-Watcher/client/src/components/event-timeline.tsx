import { useEffect, useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, AlertTriangle, Eye, Activity } from "lucide-react";

const VSS_API_URL =
  import.meta.env.VITE_VSS_API_URL || "https://vss-api.agentdemos.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEvent {
  id: number;
  camera_id: string;
  camera_name: string;
  timestamp: string;
  video_time_seconds: number;
  caption: string;
  event_type: string; // "caption" | "alert" | "scene_agent"
}

interface TimelineResponse {
  camera_id: string;
  events: TimelineEvent[];
  total: number;
}

interface EventTimelineProps {
  cameraId: string;
  onSeekTo: (videoTimeSeconds: number) => void;
  videoDuration: number;
  currentTime: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify an event into a rendering category. */
function classifyEvent(
  event: TimelineEvent
): "alert" | "scene_agent" | "caption" {
  if (
    event.event_type === "alert" ||
    event.caption.toUpperCase().includes("DETECTED")
  ) {
    return "alert";
  }
  if (event.event_type === "scene_agent") {
    return "scene_agent";
  }
  return "caption";
}

/** Format seconds into "M:SS". */
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Truncate a string to a maximum length, appending an ellipsis if needed. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "\u2026";
}

/**
 * Down-sample an array of events to at most `maxCount` items.
 * Keeps events evenly spaced across the original array while always
 * preserving alert events (higher visual priority).
 */
function downsample(
  events: TimelineEvent[],
  maxCount: number
): TimelineEvent[] {
  if (events.length <= maxCount) return events;

  // Always keep alert events
  const alerts = events.filter((e) => classifyEvent(e) === "alert");
  const nonAlerts = events.filter((e) => classifyEvent(e) !== "alert");

  const remaining = maxCount - alerts.length;
  if (remaining <= 0) {
    // More alerts than the cap — just take the first maxCount alerts
    return alerts.slice(0, maxCount);
  }

  // Evenly sample from non-alert events
  const step = nonAlerts.length / remaining;
  const sampled: TimelineEvent[] = [];
  for (let i = 0; i < remaining; i++) {
    sampled.push(nonAlerts[Math.floor(i * step)]);
  }

  return [...alerts, ...sampled].sort(
    (a, b) => a.video_time_seconds - b.video_time_seconds
  );
}

// ---------------------------------------------------------------------------
// Dot style constants
// ---------------------------------------------------------------------------

const DOT_STYLES: Record<
  "alert" | "scene_agent" | "caption",
  { size: string; color: string; ring: string; label: string }
> = {
  alert: {
    size: "h-3 w-3",
    color: "bg-red-500",
    ring: "ring-red-500/40",
    label: "Alert",
  },
  scene_agent: {
    size: "h-2.5 w-2.5",
    color: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    label: "Scene Agent",
  },
  caption: {
    size: "h-2 w-2",
    color: "bg-blue-400",
    ring: "ring-blue-400/30",
    label: "Caption",
  },
};

const MAX_VISIBLE_DOTS = 200;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventTimeline({
  cameraId,
  onSeekTo,
  videoDuration,
  currentTime,
}: EventTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ---- Data fetching -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function fetchTimeline() {
      setLoaded(false);
      try {
        const res = await fetch(
          `${VSS_API_URL}/api/captions/timeline?camera_id=${encodeURIComponent(
            cameraId
          )}&limit=500`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TimelineResponse = await res.json();
        if (!cancelled) {
          setEvents(data.events ?? []);
        }
      } catch (err) {
        console.error("[EventTimeline] Failed to fetch timeline:", err);
        if (!cancelled) {
          setEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    }

    fetchTimeline();
    return () => {
      cancelled = true;
    };
  }, [cameraId]);

  // ---- Computed dot data ----------------------------------------------------

  const dots = useMemo(() => {
    if (videoDuration <= 0) return [];

    const sampled = downsample(events, MAX_VISIBLE_DOTS);

    return sampled.map((event) => {
      const kind = classifyEvent(event);
      const pct = Math.min(
        100,
        Math.max(0, (event.video_time_seconds / videoDuration) * 100)
      );
      return { event, kind, pct };
    });
  }, [events, videoDuration]);

  // ---- Current-time indicator position -------------------------------------

  const currentPct = useMemo(() => {
    if (videoDuration <= 0) return 0;
    return Math.min(100, Math.max(0, (currentTime / videoDuration) * 100));
  }, [currentTime, videoDuration]);

  // ---- Seek handler --------------------------------------------------------

  const handleDotClick = useCallback(
    (videoTimeSeconds: number) => {
      onSeekTo(videoTimeSeconds);
    },
    [onSeekTo]
  );

  // ---- Render ---------------------------------------------------------------

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`w-full select-none transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Time labels */}
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-[10px] text-muted-foreground font-mono">
            0:00
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTime(currentTime)}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTime(videoDuration)}
          </span>
        </div>

        {/* Timeline track */}
        <div className="relative h-[28px] flex items-center px-1">
          {/* Background bar */}
          <div className="absolute inset-x-1 h-2 rounded-full bg-muted/60" />

          {/* Current-time indicator */}
          <div
            className="absolute top-0 bottom-0 w-0.5 rounded-full z-20 pointer-events-none transition-[left] duration-100 ease-linear"
            style={{
              left: `calc(${currentPct}% + 4px * (1 - ${currentPct} / 50))`,
              /* slight offset compensation so the line stays within the track */
              backgroundColor: "#76B900",
              boxShadow: "0 0 4px #76B900aa",
            }}
          />

          {/* Event dots */}
          {dots.map(({ event, kind, pct }) => {
            const style = DOT_STYLES[kind];
            const isAlert = kind === "alert";

            return (
              <Tooltip key={event.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`absolute z-10 rounded-full ${style.size} ${style.color} ring-2 ${style.ring}
                      cursor-pointer hover:scale-150 transition-transform duration-150
                      focus-visible:outline-none focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-ring
                      ${isAlert ? "animate-pulse" : ""}`}
                    style={{
                      left: `calc(${pct}%)`,
                      transform: "translateX(-50%)",
                    }}
                    onClick={() => handleDotClick(event.video_time_seconds)}
                    aria-label={`${style.label} event at ${formatTime(
                      event.video_time_seconds
                    )}`}
                  />
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-sm text-left space-y-1"
                >
                  <p className="text-xs font-medium">{event.camera_name}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3 inline-block" />
                    {formatTime(event.video_time_seconds)}
                  </p>
                  <p className="text-xs leading-snug">
                    {truncate(event.caption, 300)}
                  </p>
                  <Badge
                    variant={kind === "alert" ? "destructive" : "secondary"}
                    className="text-[10px] mt-0.5"
                  >
                    {kind === "alert" && (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    {kind === "scene_agent" && (
                      <Activity className="h-3 w-3 mr-1" />
                    )}
                    {kind === "caption" && <Eye className="h-3 w-3 mr-1" />}
                    {style.label}
                  </Badge>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-1 mt-1.5">
          {(
            Object.entries(DOT_STYLES) as [
              keyof typeof DOT_STYLES,
              (typeof DOT_STYLES)[keyof typeof DOT_STYLES],
            ][]
          ).map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className={`inline-block rounded-full ${style.size} ${style.color}`}
              />
              <span className="text-[10px] text-muted-foreground">
                {style.label}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-0.5 h-3 rounded-full"
              style={{ backgroundColor: "#76B900" }}
            />
            <span className="text-[10px] text-muted-foreground">
              Current Time
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
