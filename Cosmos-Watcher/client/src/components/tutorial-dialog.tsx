import { useState, useEffect, useCallback, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Bot,
  Camera,
  LayoutGrid,
  ChevronRight,
  ChevronLeft,
  X,
  MonitorPlay,
  Settings,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Step definitions — each targets a real DOM element by data-testid
// ---------------------------------------------------------------------------

const STEPS = [
  {
    targetTestId: "select-video-source",
    icon: MonitorPlay,
    title: "Choose a Video Source",
    description:
      "Start by selecting a video feed that best depicts your intended use case. Each source simulates a live camera \u2014 pick one to explore the AI capabilities in context.",
    featureId: "select-source",
    tryLabel: "Try it",
  },
  {
    targetTestId: "button-add-rule",
    icon: Plus,
    title: "Add a Detection Rule",
    description:
      "Describe what to watch for and the AI continuously monitors your feeds \u2014 alerting you the moment it spots a match. Monitor the whole scene or draw a region to focus on a specific area.",
    featureId: "add-rule",
    tryLabel: "Try it",
  },
  {
    targetTestId: "button-scene-agent-settings",
    icon: Settings,
    title: "Set Scene Context",
    description:
      "Tell the AI what to look for \u2014 e.g. you're monitoring for security or safety violations. Then describe what it could theoretically control in the real world, like a siren API, fire suppression system, or conveyor controls. This shapes how the model reasons and responds.",
    featureId: "scene-context",
    tryLabel: "Try it",
  },
  {
    targetTestId: "button-scene-agent",
    icon: Bot,
    title: "Scene Agent",
    description:
      "Samples a batch of frames over a minute-long window and delivers a detailed temporal analysis \u2014 identifying activities, safety concerns, and patterns across the scene.",
    featureId: "scene-agent",
    tryLabel: "Try it",
  },
  {
    targetTestId: "button-capture",
    icon: Camera,
    title: "Quick Analysis",
    description:
      "Captures a single frame for instant AI analysis \u2014 count objects, identify items, or describe the current scene.",
    featureId: "capture",
    tryLabel: "Try it",
  },
  {
    targetTestId: "button-toggle-grid",
    icon: LayoutGrid,
    title: "Search All Cameras",
    description:
      'Switch to Grid view to see every camera at once, then open Search to query across all feeds with natural language \u2014 like "worker wearing a lanyard."',
    featureId: "grid-search",
    tryLabel: "Try it",
  },
];

// ---------------------------------------------------------------------------
// Rect type + measurement hook
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PAD = 6; // padding around the highlighted element

function getTargetRect(testId: string): Rect | null {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

// Determine which side of the target has more space for the tooltip
type Side = "bottom" | "top" | "left" | "right";

function bestSide(rect: Rect): Side {
  const spaceBelow = window.innerHeight - (rect.y + rect.height);
  const spaceAbove = rect.y;
  const spaceRight = window.innerWidth - (rect.x + rect.width);
  const spaceLeft = rect.x;

  // Prefer below, then right, then above, then left
  if (spaceBelow >= 220) return "bottom";
  if (spaceRight >= 340) return "right";
  if (spaceAbove >= 220) return "top";
  if (spaceLeft >= 340) return "left";
  return "bottom";
}

function tooltipPosition(rect: Rect, side: Side) {
  const OFFSET = 16;
  switch (side) {
    case "bottom":
      return { left: rect.x + rect.width / 2, top: rect.y + rect.height + OFFSET };
    case "top":
      return { left: rect.x + rect.width / 2, top: rect.y - OFFSET };
    case "right":
      return { left: rect.x + rect.width + OFFSET, top: rect.y + rect.height / 2 };
    case "left":
      return { left: rect.x - OFFSET, top: rect.y + rect.height / 2 };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTryFeature?: (featureId: string) => void;
}

export function TutorialDialog({ open, onOpenChange, onTryFeature }: TutorialDialogProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  const step = STEPS[currentStep];
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  // Measure the target element position
  const measure = useCallback(() => {
    if (!open) return;
    const rect = getTargetRect(STEPS[currentStep].targetTestId);
    setTargetRect(rect);
  }, [open, currentStep]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Re-measure on resize and scroll
  useEffect(() => {
    if (!open) return;
    const handleResize = () => measure();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [open, measure]);

  // Lock body scroll while tour is active
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  function close() {
    onOpenChange(false);
    setTimeout(() => setCurrentStep(0), 300);
  }

  function handleTry() {
    close();
    if (onTryFeature) {
      setTimeout(() => onTryFeature(step.featureId), 150);
    }
  }

  // Compute positions
  const side = targetRect ? bestSide(targetRect) : "bottom";
  const tipPos = targetRect ? tooltipPosition(targetRect, side) : { left: 0, top: 0 };

  // Tooltip transform origin based on side
  const tooltipTransform = {
    bottom: "translate(-50%, 0)",
    top: "translate(-50%, -100%)",
    right: "translate(0, -50%)",
    left: "translate(-100%, -50%)",
  }[side];

  // Arrow styles pointing from tooltip toward the target
  const arrowStyle: Record<string, React.CSSProperties> = {
    bottom: {
      position: "absolute",
      top: -6,
      left: "50%",
      transform: "translateX(-50%)",
      width: 0,
      height: 0,
      borderLeft: "7px solid transparent",
      borderRight: "7px solid transparent",
      borderBottom: "7px solid hsl(var(--card))",
    },
    top: {
      position: "absolute",
      bottom: -6,
      left: "50%",
      transform: "translateX(-50%)",
      width: 0,
      height: 0,
      borderLeft: "7px solid transparent",
      borderRight: "7px solid transparent",
      borderTop: "7px solid hsl(var(--card))",
    },
    right: {
      position: "absolute",
      left: -6,
      top: "50%",
      transform: "translateY(-50%)",
      width: 0,
      height: 0,
      borderTop: "7px solid transparent",
      borderBottom: "7px solid transparent",
      borderRight: "7px solid hsl(var(--card))",
    },
    left: {
      position: "absolute",
      right: -6,
      top: "50%",
      transform: "translateY(-50%)",
      width: 0,
      height: 0,
      borderTop: "7px solid transparent",
      borderBottom: "7px solid transparent",
      borderLeft: "7px solid hsl(var(--card))",
    },
  };

  const springTransition = { type: "spring" as const, stiffness: 180, damping: 24 };

  return (
    <AnimatePresence>
      {open && targetRect && (
        <motion.div
          className="fixed inset-0 z-[100]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* Dark overlay with SVG mask cutout */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <mask id="tour-mask">
                <rect width="100%" height="100%" fill="white" />
                <motion.rect
                  fill="black"
                  rx={8}
                  animate={{
                    x: targetRect.x,
                    y: targetRect.y,
                    width: targetRect.width,
                    height: targetRect.height,
                  }}
                  transition={springTransition}
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.7)"
              mask="url(#tour-mask)"
            />
          </svg>

          {/* Click on overlay to dismiss */}
          <div className="absolute inset-0" onClick={close} />

          {/* Pulsing green ring around target */}
          <motion.div
            className="absolute rounded-lg pointer-events-none"
            style={{
              boxShadow: "0 0 0 2px #76B900, 0 0 12px 2px rgba(118,185,0,0.35)",
            }}
            animate={{
              left: targetRect.x,
              top: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
            }}
            transition={springTransition}
          >
            {/* Pulsing glow animation */}
            <motion.div
              className="absolute inset-0 rounded-lg"
              animate={{
                boxShadow: [
                  "0 0 0 0px rgba(118,185,0,0.4)",
                  "0 0 0 8px rgba(118,185,0,0)",
                ],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          </motion.div>

          {/* Tooltip card */}
          <motion.div
            className="absolute z-10 bg-card border border-border rounded-xl shadow-2xl w-[310px]"
            style={{ transform: tooltipTransform }}
            animate={{
              left: tipPos.left,
              top: tipPos.top,
            }}
            transition={springTransition}
          >
            {/* Arrow */}
            <div style={arrowStyle[side]} />

            <div className="p-4 pb-3">
              {/* Header: icon + title + step counter */}
              <div className="flex items-center gap-2.5 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#76B900]/15">
                  <Icon className="h-4 w-4 text-[#76B900]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm leading-tight">{step.title}</h3>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {currentStep + 1}/{STEPS.length}
                </span>
              </div>

              {/* Description */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={currentStep}
                  className="text-xs text-muted-foreground leading-relaxed"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  {step.description}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Footer: navigation */}
            <div className="flex items-center justify-between border-t px-4 py-2.5">
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 text-xs px-2 ${isFirst ? "invisible" : ""}`}
                onClick={() => setCurrentStep((s) => s - 1)}
                disabled={isFirst}
              >
                <ChevronLeft className="h-3 w-3 mr-0.5" />
                Back
              </Button>

              {/* Step dots */}
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentStep(i)}
                    className={`rounded-full transition-all duration-200 ${
                      i === currentStep
                        ? "w-4 h-1.5 bg-[#76B900]"
                        : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-[#76B900] hover:text-[#76B900]"
                  onClick={handleTry}
                >
                  {step.tryLabel}
                </Button>
                {isLast ? (
                  <Button
                    size="sm"
                    className="h-7 text-xs px-3 text-white hover:opacity-90"
                    style={{ backgroundColor: "#76B900" }}
                    onClick={close}
                  >
                    Done
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setCurrentStep((s) => s + 1)}
                  >
                    Next
                    <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Close button — top right */}
          <button
            onClick={close}
            className="fixed top-4 right-4 z-10 p-2 rounded-full bg-card/80 border border-border backdrop-blur-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
