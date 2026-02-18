import { useRef, useEffect, useCallback, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Video, VideoOff } from "lucide-react";
import { motion } from "framer-motion";
import type { VideoSource } from "@shared/schema";

interface CameraGridProps {
  videoSources: VideoSource[];
  onSelectSource: (sourceId: string) => void;
  currentSourceId: string;
  getVideoUrl: (source: VideoSource) => string;
}

interface CameraCellProps {
  source: VideoSource;
  isSelected: boolean;
  onSelect: (sourceId: string) => void;
  videoUrl: string;
}

const CameraCell = memo(function CameraCell({
  source,
  isSelected,
  onSelect,
  videoUrl,
}: CameraCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.play().catch(() => {
      // Autoplay may be blocked by browser policy; silent fail is acceptable
    });
  }, [videoUrl]);

  const handleClick = useCallback(() => {
    onSelect(source.id);
  }, [onSelect, source.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="cursor-pointer"
      onClick={handleClick}
    >
      <Card
        className={`overflow-hidden transition-all duration-200 hover:shadow-lg ${
          isSelected ? "ring-2" : "hover:ring-1 hover:ring-muted-foreground/30"
        }`}
        style={isSelected ? { borderColor: "#76B900" } : undefined}
      >
        <CardContent className="p-0">
          <div className="relative aspect-video bg-black">
            {source.isActive !== false && videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                onError={() => {
                  // Video load error handled silently; the VideoOff fallback
                  // will show if the element fails to render content
                }}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <VideoOff className="h-8 w-8 text-muted-foreground/50" />
              </div>
            )}

            {/* Camera name overlay */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white truncate mr-2">
                  {source.name}
                </span>
                {source.isActive !== false && (
                  <Badge
                    variant="default"
                    className="bg-green-600 hover:bg-green-600 text-white text-[10px] px-1.5 py-0 leading-4 shrink-0"
                  >
                    <span className="relative mr-1 flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-300 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-300" />
                    </span>
                    LIVE
                  </Badge>
                )}
              </div>
            </div>

            {/* Selected indicator */}
            {isSelected && (
              <div className="absolute top-2 right-2">
                <div
                  className="h-2.5 w-2.5 rounded-full shadow-sm"
                  style={{ backgroundColor: "#76B900" }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
});

export function CameraGrid({
  videoSources,
  onSelectSource,
  currentSourceId,
  getVideoUrl,
}: CameraGridProps) {
  if (videoSources.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Video className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No video sources configured
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {videoSources.map((source) => (
        <CameraCell
          key={source.id}
          source={source}
          isSelected={source.id === currentSourceId}
          onSelect={onSelectSource}
          videoUrl={getVideoUrl(source)}
        />
      ))}
    </div>
  );
}
