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
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Send, Loader2, Hash, Box, Sparkles, ChevronDown } from "lucide-react";

interface CountItem {
  id: number;
  label: string;
  confidence: number;
  box: [number, number, number, number];
}

interface CountData {
  count: number;
  items: CountItem[];
  notes?: string;
}

/** Extract <think>...</think> block from model response. */
function extractThinking(text: string): { thinking: string | null; clean: string } {
  const match = text.match(/<think>([\s\S]*?)<\/think>/);
  if (match) {
    const thinking = match[1].trim();
    const clean = (text.slice(0, match.index) + text.slice(match.index! + match[0].length)).trim();
    return { thinking, clean };
  }
  return { thinking: null, clean: text };
}

function ThinkingAccordion({ thinking }: { thinking: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
        <Sparkles className="h-3.5 w-3.5 text-[#76b900]" />
        <span className="font-medium">AI Reasoning</span>
        <ChevronDown className={`h-3 w-3 ml-auto transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md bg-muted/30 border border-border/40 px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{thinking}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface QuickAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  frameData: string | null;
  sceneContext?: string;
}

export function QuickAnalysisModal({ isOpen, onClose, frameData, sceneContext }: QuickAnalysisModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [mode, setMode] = useState<"qa" | "mark_count" | null>(null);
  const [countData, setCountData] = useState<CountData | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);

  const handleClose = () => {
    setPrompt("");
    setResponse(null);
    setModelUsed(null);
    setMode(null);
    setCountData(null);
    setThinking(null);
    setIsAnalyzing(false);
    onClose();
  };

  const getModelDisplayName = (model: string): string => {
    switch (model) {
      case "gpt-4o":
        return "GPT-4o (Precision)";
      case "cosmos-reason2":
        return "Cosmos (Q&A)";
      case "cosmos-reason2-count":
        return "Cosmos (Count)";
      default:
        return model;
    }
  };

  const handleAnalyze = async () => {
    if (!prompt.trim() || !frameData) return;

    setIsAnalyzing(true);
    setResponse(null);
    setModelUsed(null);
    setMode(null);
    setCountData(null);
    setThinking(null);

    try {
      const res = await fetch("/api/analyze-adhoc", {
        method: "POST",
        body: JSON.stringify({ frameData, prompt: prompt.trim(), sceneContext }),
        headers: { "Content-Type": "application/json" },
      });
      
      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.statusText}`);
      }
      
      const result = await res.json();
      const rawAnalysis = result.analysis || "No response received from the model. Please try again.";
      const { thinking: extractedThinking, clean } = extractThinking(rawAnalysis);
      setResponse(clean);
      setThinking(extractedThinking);
      setModelUsed(result.model || null);
      setMode(result.mode || "qa");
      if (result.countData) {
        setCountData(result.countData);
      }
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
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col border-2 border-[#76b900]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Quick Frame Analysis</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {frameData && (
            <div className="rounded-lg overflow-hidden bg-black/50">
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
              className="shrink-0 bg-[#76b900]"
              data-testid="button-analyze"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Shimmer loading placeholder */}
          {isAnalyzing && !response && (
            <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#76b900]" />
                <span className="text-xs text-muted-foreground">Analyzing frame...</span>
              </div>
              <div className="space-y-2">
                <div className="h-3 bg-muted rounded animate-pulse w-full" />
                <div className="h-3 bg-muted rounded animate-pulse w-4/5" />
                <div className="h-3 bg-muted rounded animate-pulse w-3/5" />
              </div>
            </div>
          )}

          {response && (
            <ScrollArea className="flex-1 max-h-[250px]">
              <div className="p-4 rounded-lg bg-muted/50 border">
                {modelUsed && (
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <span className="text-xs text-muted-foreground">Analyzed by:</span>
                    <span 
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        modelUsed === "gpt-4o" 
                          ? "bg-blue-500/20 text-blue-400" 
                          : "bg-[#76b900]/20 text-[#76b900]"
                      }`}
                      data-testid="badge-model-used"
                    >
                      {getModelDisplayName(modelUsed)}
                    </span>
                    {mode === "mark_count" && (
                      <Badge variant="outline" className="text-xs ml-auto">
                        <Hash className="h-3 w-3 mr-1" />
                        Count Mode
                      </Badge>
                    )}
                  </div>
                )}
                
                {thinking && (
                  <div className="mb-3 pb-2 border-b">
                    <ThinkingAccordion thinking={thinking} />
                  </div>
                )}

                {mode === "mark_count" && countData ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-[#76b900]" data-testid="text-count-result">
                        {countData.count}
                      </span>
                      <span className="text-sm text-muted-foreground">items detected</span>
                    </div>
                    
                    {countData.items && countData.items.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Detected Items:</p>
                        {countData.items.map((item, i) => (
                          <div 
                            key={item.id || i} 
                            className="flex items-center gap-2 text-sm p-2 rounded bg-background/50"
                            data-testid={`count-item-${i}`}
                          >
                            <Box className="h-3 w-3 text-[#76b900]" />
                            <span className="font-medium">{item.label}</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {countData.notes && (
                      <p className="text-xs text-muted-foreground italic pt-2 border-t">
                        {countData.notes}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-analysis-response">
                    {response}
                  </p>
                )}
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
