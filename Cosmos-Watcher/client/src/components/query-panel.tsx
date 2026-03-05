import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Send,
  Loader2,
  Video,
  Clock,
  MapPin,
  X,
  Trash2,
  MessageSquare,
  LayoutGrid,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  chroma_id: string;
  camera_id: string;
  camera_name: string;
  video_time_seconds: number;
  caption: string;
  similarity: number;
  timestamp: string;
  frame_thumbnail_b64?: string;
}

interface Message {
  id: string;
  type: "user" | "assistant" | "results";
  content: string;
  results?: SearchResult[];
  timestamp: Date;
  mode?: "grid" | "single"; // track which mode produced these results
}

interface QueryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onResultClick: (cameraId: string, videoTimeSeconds: number) => void;
  isGridView: boolean;
  currentCameraId: string;
  currentCameraName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VSS_API_URL =
  import.meta.env.VITE_VSS_API_URL || "https://vss-api.agentdemos.com";

const PANEL_WIDTH = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatVideoTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function similarityColor(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return "bg-emerald-600/80 text-emerald-50";
  if (pct >= 60) return "bg-yellow-600/80 text-yellow-50";
  return "bg-red-600/80 text-red-50";
}

/**
 * Deduplicate results by camera — keep only the highest-similarity result
 * per camera_id, preserving original relevance order.
 */
function deduplicateByCamera(results: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const r of results) {
    const existing = best.get(r.camera_id);
    if (!existing || r.similarity > existing.similarity) {
      best.set(r.camera_id, r);
    }
  }
  // Return in original relevance order, one per camera
  return results.filter((r) => best.get(r.camera_id) === r);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ isGridView, cameraName }: { isGridView: boolean; cameraName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-4 select-none">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Search className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Ask questions about your video feeds
        </p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          {isGridView
            ? "Search across all cameras to find which feeds match your query."
            : `Search within ${cameraName || "this camera"} to find specific moments.`}
        </p>
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onClick,
  isGridResult,
}: {
  result: SearchResult;
  onClick: () => void;
  isGridResult: boolean;
}) {
  const pct = Math.round(result.similarity * 100);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border border-border/60 bg-card/60 p-3 space-y-2",
        "transition-colors hover:bg-accent/40 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          {isGridResult ? (
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : (
            <Video className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate font-medium text-foreground">
            {result.camera_name}
          </span>
        </div>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 border-none shrink-0",
            similarityColor(result.similarity),
          )}
        >
          {pct}%
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {result.caption}
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatVideoTime(result.video_time_seconds)}
        </span>
        {result.timestamp && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {new Date(result.timestamp).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QueryPanel({
  isOpen,
  onClose,
  onResultClick,
  isGridView,
  currentCameraId,
  currentCameraName,
}: QueryPanelProps) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);   // reranking phase
  const [isSynthesizing, setIsSynthesizing] = useState(false); // answer-streaming phase
  const [results, setResults] = useState<SearchResult[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to wait for animation
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const totalResultCount = messages.reduce(
    (sum, m) => sum + (m.results?.length ?? 0),
    0,
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    setResults([]);
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed || isSearching || isSynthesizing) return;

      const searchMode = isGridView ? "grid" : "single";
      const cameraId = isGridView ? undefined : currentCameraId;

      // Add user message immediately
      const userMessage: Message = {
        id: generateId(),
        type: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setQuery("");
      setIsSearching(true);

      // IDs for the messages we'll inject progressively
      const assistantMsgId = generateId();
      const resultsMsgId = generateId();

      try {
        const body: Record<string, unknown> = {
          query: trimmed,
          mode: searchMode,
          n_results: searchMode === "grid" ? 20 : 10,
        };
        if (cameraId) body.camera_id = cameraId;

        const response = await fetch(`${VSS_API_URL}/api/query/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Search failed (${response.status})`);
        }

        // Parse SSE stream manually (EventSource only supports GET)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEventType = "";
        let answerAccumulator = "";
        let resultsShown = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const raw = line.slice(6).trim();
              if (!raw) continue;

              if (currentEventType === "results") {
                // ── Phase 1 complete: reranking done, show clips immediately ──
                setIsSearching(false);
                setIsSynthesizing(true);

                let rawResults: Record<string, unknown>[] = [];
                try { rawResults = JSON.parse(raw); } catch { /* ignore */ }

                let searchResults: SearchResult[] = rawResults.map((r) => ({
                  chroma_id: (r.chroma_id ?? r.id ?? generateId()) as string,
                  camera_id: (r.camera_id ?? "") as string,
                  camera_name: (r.camera_name ?? "Unknown Camera") as string,
                  video_time_seconds: Number(r.video_time_seconds ?? 0),
                  caption: (r.caption ?? "") as string,
                  similarity: Number(r.similarity ?? r.score ?? 0),
                  timestamp: (r.timestamp ?? "") as string,
                  frame_thumbnail_b64: r.frame_thumbnail_b64 as string | undefined,
                }));

                if (searchMode === "grid") {
                  searchResults = deduplicateByCamera(searchResults);
                }

                const countLabel =
                  searchMode === "grid"
                    ? `${searchResults.length} camera${searchResults.length !== 1 ? "s" : ""} matched`
                    : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} found`;

                setResults(searchResults);
                setMessages((prev) => [
                  ...prev,
                  // Placeholder assistant bubble — will fill in as chunks arrive
                  { id: assistantMsgId, type: "assistant", content: "", timestamp: new Date() },
                  { id: resultsMsgId, type: "results", content: countLabel, results: searchResults, timestamp: new Date(), mode: searchMode },
                ]);
                resultsShown = true;

              } else if (currentEventType === "chunk") {
                // ── Phase 2: stream answer text into the assistant bubble ──
                const chunk = raw.startsWith('"') ? JSON.parse(raw) : raw;
                answerAccumulator += chunk;
                const currentAnswer = answerAccumulator;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: currentAnswer }
                      : m,
                  ),
                );

              } else if (currentEventType === "done") {
                // ── Stream complete ──
                setIsSynthesizing(false);
                // If we never got a results event (empty result set), show fallback
                if (!resultsShown) {
                  try {
                    const doneData = JSON.parse(raw);
                    const fallbackAnswer = doneData?.answer ?? "No matching footage found.";
                    setMessages((prev) => [
                      ...prev,
                      { id: assistantMsgId, type: "assistant", content: fallbackAnswer, timestamp: new Date() },
                    ]);
                  } catch { /* ignore */ }
                }
              }
            }
          }
        }
      } catch (err) {
        setIsSearching(false);
        setIsSynthesizing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            type: "assistant",
            content: err instanceof Error ? `Search failed: ${err.message}` : "An unexpected error occurred while searching.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsSearching(false);
        setIsSynthesizing(false);
      }
    },
    [query, isSearching, isSynthesizing, isGridView, currentCameraId],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: PANEL_WIDTH }}
          animate={{ x: 0 }}
          exit={{ x: PANEL_WIDTH }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          className="fixed top-0 right-0 bottom-0 z-50 flex flex-col border-l border-border bg-background shadow-xl"
          style={{ width: PANEL_WIDTH }}
        >
          {/* ---- Header ---- */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Video Search</h2>
                  {totalResultCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {totalResultCount}
                    </Badge>
                  )}
                </div>
                {/* Context indicator: shows current search scope */}
                <div className="flex items-center gap-1 mt-0.5">
                  {isGridView ? (
                    <LayoutGrid className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : (
                    <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <p className="text-[10px] text-muted-foreground truncate leading-none">
                    {isGridView ? "All cameras" : (currentCameraName || "Single camera")}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {messages.length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleClear}
                  aria-label="Clear search history"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                aria-label="Close search panel"
                className="h-7 w-7"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* ---- Chat area ---- */}
          <ScrollArea className="flex-1 min-h-0">
            <div ref={scrollRef} className="flex flex-col gap-3 p-4">
              {messages.length === 0 && !isSearching && (
                <EmptyState isGridView={isGridView} cameraName={currentCameraName} />
              )}

              {messages.map((msg) => {
                if (msg.type === "user") {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-emerald-700/30 border border-emerald-700/40 px-3 py-2">
                        <p className="text-sm text-foreground">{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                if (msg.type === "assistant") {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[85%] rounded-lg bg-muted/60 border border-border/50 px-3 py-2">
                        <p className="text-sm text-foreground leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  );
                }

                // Results
                if (msg.type === "results" && msg.results?.length) {
                  const isGridResult = msg.mode === "grid";
                  return (
                    <div key={msg.id} className="space-y-2">
                      {/* Result count label */}
                      <p className="text-[10px] text-muted-foreground px-1">
                        {msg.content}
                        {isGridResult && (
                          <span className="ml-1 text-muted-foreground/60">
                            — click to open camera
                          </span>
                        )}
                      </p>
                      {msg.results.map((result) => (
                        <ResultCard
                          key={result.chroma_id}
                          result={result}
                          isGridResult={isGridResult}
                          onClick={() =>
                            onResultClick(
                              result.camera_id,
                              result.video_time_seconds,
                            )
                          }
                        />
                      ))}
                    </div>
                  );
                }

                return null;
              })}

              {/* Searching indicator — reranking phase */}
              {isSearching && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-muted/60 border border-border/50 px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Searching {isGridView ? "all cameras" : (currentCameraName || "camera")}...
                    </span>
                  </div>
                </div>
              )}

              {/* Synthesizing indicator — answer streaming phase */}
              {isSynthesizing && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-muted/60 border border-border/50 px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                    <span className="text-sm text-muted-foreground">
                      Analyzing results...
                    </span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* ---- Input bar ---- */}
          <form
            onSubmit={handleSubmit}
            className="shrink-0 flex items-center gap-2 border-t border-border px-3 py-3 bg-background"
          >
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isGridView
                  ? "Search all cameras..."
                  : `Search ${currentCameraName || "this camera"}...`
              }
              disabled={isSearching}
              className="flex-1 bg-muted/40 border-border/60 text-sm placeholder:text-muted-foreground/60"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!query.trim() || isSearching || isSynthesizing}
              className="shrink-0 bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-800"
              aria-label="Send search query"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
