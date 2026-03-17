import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Bot,
  Camera,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STEPS = [
  {
    icon: Bell,
    title: "Set Up an Alert",
    description:
      'Create monitoring prompts that continuously analyze your camera feeds. Click the "+ New Prompt" button below any camera, describe what to watch for (e.g., "person in restricted area"), and the AI will alert you when it detects a match.',
    color: "bg-amber-500/15 text-amber-500",
  },
  {
    icon: Bot,
    title: "Run the Scene Agent",
    description:
      "Click the robot icon below a camera to launch a multi-frame temporal analysis. The AI watches several seconds of video and provides a detailed scene understanding \u2014 identifying activities, interactions, and patterns over time.",
    color: "bg-emerald-500/15 text-emerald-500",
  },
  {
    icon: Camera,
    title: "Count Items in a Scene",
    description:
      "Click the camera icon below any feed to run an instant single-frame analysis. Ask the AI to count objects, identify items, or describe what it sees right now. Great for quick inventory checks or situational snapshots.",
    color: "bg-blue-500/15 text-blue-500",
  },
  {
    icon: Search,
    title: "Search Across Videos",
    description:
      'Click the Search button in the header to open the semantic search panel. Type a natural language query like "worker wearing a lanyard" and the AI searches across all indexed camera feeds to find matching moments.',
    color: "bg-purple-500/15 text-purple-500",
  },
];

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TutorialDialog({ open, onOpenChange }: TutorialDialogProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const step = STEPS[currentStep];
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  function handleOpenChange(value: boolean) {
    if (!value) {
      // Reset to first step when closing
      setTimeout(() => setCurrentStep(0), 200);
    }
    onOpenChange(value);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0 overflow-hidden">
        <div className="p-6 pb-4">
          <DialogHeader className="space-y-4">
            {/* Step icon */}
            <div className="flex justify-center">
              <div className={`rounded-2xl p-4 ${step.color}`}>
                <Icon className="h-8 w-8" />
              </div>
            </div>

            {/* Title + step counter */}
            <div className="space-y-1.5 text-center">
              <DialogTitle className="text-xl">{step.title}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Step {currentStep + 1} of {STEPS.length}
              </p>
            </div>

            {/* Description */}
            <DialogDescription className="text-center text-sm leading-relaxed">
              {step.description}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Navigation footer */}
        <div className="border-t bg-muted/30 px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Back button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentStep((s) => s - 1)}
              disabled={isFirst}
              className={isFirst ? "invisible" : ""}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>

            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={`h-2 w-2 rounded-full transition-all ${
                    i === currentStep
                      ? "bg-primary scale-125"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {/* Next / Get Started button */}
            {isLast ? (
              <Button
                size="sm"
                onClick={() => handleOpenChange(false)}
                style={{ backgroundColor: "#76B900" }}
                className="text-white hover:opacity-90"
              >
                Get Started
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentStep((s) => s + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
