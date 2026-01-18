import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Cpu, Server } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CosmosHealthData {
  status: string;
  endpoint: string;
  apiLive: boolean;
  modelLoaded: boolean;
  gpu?: string;
  modelId?: string;
  cuda?: boolean;
  error?: string;
}

export function CosmosHealth() {
  const { data, isLoading, isError } = useQuery<CosmosHealthData>({
    queryKey: ["/api/cosmos/health"],
    refetchInterval: 30000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="cosmos-health-loading">
        <Server className="h-3 w-3 animate-pulse" />
        <span>Checking API...</span>
      </div>
    );
  }

  const apiLive = !isError && data?.apiLive;
  const modelLoaded = data?.modelLoaded;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 cursor-help" data-testid="cosmos-health-status">
          <div className="flex items-center gap-1.5">
            {apiLive ? (
              <Wifi className="h-3 w-3 text-green-500" />
            ) : (
              <WifiOff className="h-3 w-3 text-red-500" />
            )}
            <Badge 
              variant={apiLive ? "default" : "destructive"} 
              className="text-[10px] px-1.5 py-0"
            >
              {apiLive ? "API Live" : "API Down"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu className={`h-3 w-3 ${modelLoaded ? "text-green-500" : "text-yellow-500"}`} />
            <Badge 
              variant={modelLoaded ? "default" : "secondary"} 
              className="text-[10px] px-1.5 py-0"
            >
              {modelLoaded ? "Model Ready" : "Model Loading"}
            </Badge>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <div className="space-y-1">
          <p><strong>Cosmos Reason 2 Status</strong></p>
          <p>API: {apiLive ? "Connected" : "Unavailable"}</p>
          <p>Model: {modelLoaded ? "Loaded & Ready" : "Not Loaded"}</p>
          {data?.gpu && <p>GPU: {data.gpu}</p>}
          {data?.modelId && <p>Model: {data.modelId}</p>}
          {data?.error && <p className="text-red-400">Error: {data.error}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
