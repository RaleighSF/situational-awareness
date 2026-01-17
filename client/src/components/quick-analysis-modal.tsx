import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2 } from "lucide-react";

interface QuickAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  frameData: string | null;
}

export function QuickAnalysisModal({ isOpen, onClose, frameData }: QuickAnalysisModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [response, setResponse] = useState<string | null>(null);

  const handleClose = () => {
    setPrompt("");
    setResponse(null);
    setIsAnalyzing(false);
    onClose();
  };

  const handleAnalyze = async () => {
    if (!prompt.trim() || !frameData) return;

    setIsAnalyzing(true);
    setResponse(null);

    try {
      const res = await fetch("/api/analyze-adhoc", {
        method: "POST",
        body: JSON.stringify({ frameData, prompt: prompt.trim() }),
        headers: { "Content-Type": "application/json" },
      });
      
      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.statusText}`);
      }
      
      const result = await res.json();
      setResponse(result.analysis || "No response received from the model. Please try again.");
    } catch (error) {
      setResponse(`Error: ${error instanceof Error ? error.message : "Analysis failed"}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isAnalyzing && prompt.trim()) {
      e.preventDefault();
      handleAnalyze();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Quick Frame Analysis</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {frameData && (
            <div className="rounded-lg overflow-hidden border-2 border-[#76b900] bg-black/50">
              <img
                src={frameData}
                alt="Captured frame"
                className="w-full h-auto max-h-[300px] object-contain"
                data-testid="img-captured-frame"
              />
            </div>
          )}

          <div className="flex items-end gap-2">
            <Textarea
              placeholder="Ask anything about this frame... (e.g., 'Count the boxes in this image')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isAnalyzing}
              className="flex-1 min-h-[80px] resize-none"
              data-testid="input-adhoc-prompt"
            />
            <Button
              size="icon"
              onClick={handleAnalyze}
              disabled={!prompt.trim() || isAnalyzing}
              className="h-10 w-10 shrink-0 bg-[#76b900] hover:bg-[#76b900]/90"
              data-testid="button-analyze"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {response && (
            <ScrollArea className="flex-1 max-h-[200px]">
              <div className="p-4 rounded-lg bg-muted/50 border">
                <p className="text-sm whitespace-pre-wrap" data-testid="text-analysis-response">
                  {response}
                </p>
              </div>
            </ScrollArea>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={handleClose} data-testid="button-close-modal">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
