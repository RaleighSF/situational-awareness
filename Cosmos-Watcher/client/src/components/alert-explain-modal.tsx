import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  Lightbulb,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AlertExplainData {
  frameData: string;
  ruleText: string;
  confidence: string;
  cameraId?: string;
  sceneContext?: string;
  boundingBox?: BoundingBox | null;
}

interface ExplainSections {
  description?: string;
  evidence_for?: string;
  evidence_against?: string;
  environmental?: string;
  recommendation?: string;
}

interface ExplainResponse {
  explanation: string;
  verdict: string;
  confidence: string;
  sections: ExplainSections;
}

export interface AlertExplainModalProps {
  isOpen: boolean;
  onClose: () => void;
  alertData: AlertExplainData | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VSS_API_URL =
  import.meta.env.VITE_VSS_API_URL || "https://vss-api.agentdemos.com";

type Verdict = "TRUE POSITIVE" | "FALSE POSITIVE" | "INCONCLUSIVE";

const VERDICT_CONFIG: Record<
  Verdict,
  { bg: string; text: string; border: string; icon: typeof ShieldAlert }
> = {
  "TRUE POSITIVE": {
    bg: "bg-red-500/20",
    text: "text-red-400",
    border: "border-red-500/40",
    icon: ShieldAlert,
  },
  "FALSE POSITIVE": {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    icon: ShieldCheck,
  },
  INCONCLUSIVE: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    border: "border-amber-500/40",
    icon: ShieldQuestion,
  },
};

const CONFIDENCE_DOT: Record<string, string> = {
  HIGH: "bg-emerald-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-red-500",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse bullet-list text into individual items. Handles newline-separated,
 *  dash-prefixed, or numbered lists. */
function parseBulletItems(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\n/)
    .map((line) => line.replace(/^[\s]*[-*\u2022\d.]+[\s]*/, "").trim())
    .filter(Boolean);
}

/** Normalise the verdict string returned by the API to a known key. */
function normaliseVerdict(raw: string): Verdict {
  const upper = raw.toUpperCase().trim();
  if (upper.includes("TRUE")) return "TRUE POSITIVE";
  if (upper.includes("FALSE")) return "FALSE POSITIVE";
  return "INCONCLUSIVE";
}

/** Normalise the confidence string returned by the API. */
function normaliseConfidence(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.includes("HIGH")) return "HIGH";
  if (upper.includes("LOW")) return "LOW";
  return "MEDIUM";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof Eye;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-4 w-4 text-[#76B900]" />
      <h4 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        {title}
      </h4>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FrameDisplay({
  frameData,
  boundingBox,
}: {
  frameData: string;
  boundingBox?: BoundingBox | null;
}) {
  return (
    <div className="relative rounded-lg overflow-hidden bg-black/60 border border-border/50">
      <img
        src={frameData}
        alt="Alert frame capture"
        className="w-full h-auto max-h-[280px] object-contain"
        data-testid="img-explain-frame"
      />
      {boundingBox && (
        <div
          className="absolute border-2 border-red-500 bg-red-500/15 rounded-sm pointer-events-none"
          style={{
            left: `${boundingBox.x}%`,
            top: `${boundingBox.y}%`,
            width: `${boundingBox.width}%`,
            height: `${boundingBox.height}%`,
          }}
          data-testid="bounding-box-overlay"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AlertExplainModal({
  isOpen,
  onClose,
  alertData,
}: AlertExplainModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  const fetchExplanation = useCallback(
    async (data: AlertExplainData) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      reset();
      setLoading(true);

      try {
        const res = await fetch(`${VSS_API_URL}/api/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            frame_b64: data.frameData,
            rule_text: data.ruleText,
            confidence: data.confidence,
            camera_id: data.cameraId,
            scene_context: data.sceneContext,
            bounding_box: data.boundingBox ?? null,
          }),
        });

        if (!res.ok) {
          throw new Error(
            `Explain request failed: ${res.status} ${res.statusText}`,
          );
        }

        const json: ExplainResponse = await res.json();
        setResult(json);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred",
        );
      } finally {
        setLoading(false);
      }
    },
    [reset],
  );

  // Trigger fetch when modal opens with data
  useEffect(() => {
    if (isOpen && alertData) {
      fetchExplanation(alertData);
    }
    if (!isOpen) {
      abortRef.current?.abort();
      reset();
    }
  }, [isOpen, alertData, fetchExplanation, reset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const verdict = result ? normaliseVerdict(result.verdict) : null;
  const verdictConfig = verdict ? VERDICT_CONFIG[verdict] : null;
  const VerdictIcon = verdictConfig?.icon ?? ShieldQuestion;
  const confidence = result ? normaliseConfidence(result.confidence) : null;
  const confidenceDot = confidence
    ? CONFIDENCE_DOT[confidence] ?? "bg-muted-foreground"
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-[700px] max-h-[90vh] p-0 overflow-hidden border-2 border-[#76B900]/40"
        data-testid="alert-explain-modal"
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#76B900]/15 flex items-center justify-center shrink-0">
              <Brain className="h-5 w-5 text-[#76B900]" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                AI Alert Explanation
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Detailed analysis of the triggered detection
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-80px)]">
          <div className="px-6 pb-6 space-y-5">
            {/* Frame preview */}
            {alertData?.frameData && (
              <FrameDisplay
                frameData={alertData.frameData}
                boundingBox={alertData.boundingBox}
              />
            )}

            {/* Rule text context */}
            {alertData?.ruleText && (
              <div className="rounded-md bg-muted/40 border border-border/50 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Detection Rule
                </p>
                <p className="text-sm">{alertData.ruleText}</p>
              </div>
            )}

            <Separator />

            {/* Loading state */}
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-12 gap-3"
                data-testid="explain-loading"
              >
                <Loader2 className="h-8 w-8 animate-spin text-[#76B900]" />
                <p className="text-sm text-muted-foreground">
                  Analyzing alert with AI...
                </p>
              </motion.div>
            )}

            {/* Error state */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-950/30 border border-red-900 p-4 flex items-start gap-3"
                data-testid="explain-error"
              >
                <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-100">
                    Analysis Failed
                  </p>
                  <p className="text-sm text-red-300 mt-1">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => alertData && fetchExplanation(alertData)}
                    data-testid="button-retry-explain"
                  >
                    Retry
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Result */}
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-5"
                  data-testid="explain-result"
                >
                  {/* Verdict + Confidence row */}
                  <div className="flex flex-wrap items-center gap-3">
                    {verdictConfig && (
                      <Badge
                        className={`text-sm px-3 py-1.5 ${verdictConfig.bg} ${verdictConfig.text} ${verdictConfig.border} border`}
                        data-testid="verdict-badge"
                      >
                        <VerdictIcon className="h-4 w-4 mr-1.5" />
                        {verdict}
                      </Badge>
                    )}

                    {confidence && (
                      <div
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                        data-testid="confidence-display"
                      >
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${confidenceDot}`}
                        />
                        <span>
                          {confidence.charAt(0) +
                            confidence.slice(1).toLowerCase()}{" "}
                          Confidence
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {result.sections.description && (
                    <div>
                      <SectionHeader icon={Eye} title="Description" />
                      <p className="text-sm leading-relaxed whitespace-pre-line">
                        {result.sections.description}
                      </p>
                    </div>
                  )}

                  {/* Evidence For */}
                  {result.sections.evidence_for && (
                    <div>
                      <SectionHeader
                        icon={AlertTriangle}
                        title="Evidence For Alert"
                      />
                      <BulletList
                        items={parseBulletItems(result.sections.evidence_for)}
                      />
                    </div>
                  )}

                  {/* Evidence Against */}
                  {result.sections.evidence_against && (
                    <div>
                      <SectionHeader
                        icon={CheckCircle2}
                        title="Evidence Against Alert"
                      />
                      <BulletList
                        items={parseBulletItems(
                          result.sections.evidence_against,
                        )}
                      />
                    </div>
                  )}

                  {/* Environmental Factors */}
                  {result.sections.environmental && (
                    <div>
                      <SectionHeader
                        icon={Lightbulb}
                        title="Environmental Factors"
                      />
                      <BulletList
                        items={parseBulletItems(result.sections.environmental)}
                      />
                    </div>
                  )}

                  {/* Recommendation */}
                  {result.sections.recommendation && (
                    <div>
                      <SectionHeader icon={Brain} title="Recommendation" />
                      <p className="text-sm leading-relaxed whitespace-pre-line">
                        {result.sections.recommendation}
                      </p>
                    </div>
                  )}

                  <Separator />

                  {/* Action buttons */}
                  <div
                    className="flex flex-wrap items-center gap-2 pt-1"
                    data-testid="explain-actions"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClose}
                      data-testid="button-acknowledge"
                    >
                      Acknowledge
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClose}
                      data-testid="button-dismiss"
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleClose}
                      data-testid="button-escalate"
                    >
                      Escalate
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
