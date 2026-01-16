import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Maximize2, Square, Camera } from "lucide-react";
import { BoundingBox } from "@shared/schema";

export interface VideoPlayerRef {
  captureFrame: (boundingBox?: BoundingBox | null) => string | null;
}

interface VideoPlayerProps {
  videoUrl: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onBoundingBoxChange?: (box: BoundingBox | null) => void;
  activeBoundingBox?: BoundingBox | null;
  isDrawingMode?: boolean;
  onFrameCapture?: (frameData: string) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  function VideoPlayer(
    {
      videoUrl,
      isPlaying,
      onPlayPause,
      onBoundingBoxChange,
      activeBoundingBox,
      isDrawingMode = false,
      onFrameCapture,
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
    const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null);
    const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
      if (videoRef.current) {
        if (isPlaying) {
          videoRef.current.play().catch(() => {
          });
        } else {
          videoRef.current.pause();
        }
      }
    }, [isPlaying]);

    useEffect(() => {
      setCurrentBox(activeBoundingBox || null);
    }, [activeBoundingBox]);

    const handleVideoLoad = () => {
      if (videoRef.current) {
        setVideoDimensions({
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight,
        });
      }
    };

    const getRelativePosition = useCallback((e: React.MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
      if (!isDrawingMode) return;
      const pos = getRelativePosition(e);
      setIsDrawing(true);
      setDrawStart(pos);
      setCurrentBox(null);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDrawing || !drawStart) return;
      const pos = getRelativePosition(e);
      const box: BoundingBox = {
        x: Math.min(drawStart.x, pos.x),
        y: Math.min(drawStart.y, pos.y),
        width: Math.abs(pos.x - drawStart.x),
        height: Math.abs(pos.y - drawStart.y),
      };
      setCurrentBox(box);
    };

    const handleMouseUp = () => {
      if (isDrawing && currentBox && currentBox.width > 1 && currentBox.height > 1) {
        onBoundingBoxChange?.(currentBox);
      }
      setIsDrawing(false);
      setDrawStart(null);
    };

    const clearBoundingBox = () => {
      setCurrentBox(null);
      onBoundingBoxChange?.(null);
    };

    const captureFrameWithBox = useCallback((box?: BoundingBox | null): string | null => {
      if (!videoRef.current || !canvasRef.current) {
        console.log("[VideoPlayer] No video or canvas ref");
        return null;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.log("[VideoPlayer] No canvas context");
        return null;
      }

      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        console.log(`[VideoPlayer] Video not ready: readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
        return null;
      }

      const targetBox = box ?? currentBox;

      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        if (targetBox) {
          const sx = (targetBox.x / 100) * video.videoWidth;
          const sy = (targetBox.y / 100) * video.videoHeight;
          const sw = (targetBox.width / 100) * video.videoWidth;
          const sh = (targetBox.height / 100) * video.videoHeight;

          canvas.width = Math.max(1, sw);
          canvas.height = Math.max(1, sh);
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        } else {
          ctx.drawImage(video, 0, 0);
        }

        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        if (dataUrl.length < 100) {
          console.log("[VideoPlayer] Frame capture produced empty data");
          return null;
        }
        return dataUrl;
      } catch (error) {
        console.error("[VideoPlayer] Error capturing frame:", error);
        return null;
      }
    }, [currentBox]);

    useImperativeHandle(ref, () => ({
      captureFrame: captureFrameWithBox,
    }), [captureFrameWithBox]);

    const handleCaptureClick = () => {
      const frameData = captureFrameWithBox();
      if (frameData) {
        onFrameCapture?.(frameData);
      }
    };

    const handleRestart = () => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    };

    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="relative aspect-video bg-black cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            data-testid="video-container"
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleVideoLoad}
              onCanPlay={() => {
                if (videoRef.current && isPlaying) {
                  videoRef.current.play().catch(() => {});
                }
              }}
              onError={(e) => {
                console.error("[VideoPlayer] Video error:", e);
              }}
              data-testid="video-element"
            />

            {currentBox && (
              <div
                className="absolute border-2 border-primary bg-primary/20 pointer-events-none"
                style={{
                  left: `${currentBox.x}%`,
                  top: `${currentBox.y}%`,
                  width: `${currentBox.width}%`,
                  height: `${currentBox.height}%`,
                }}
                data-testid="bounding-box"
              >
                <div className="absolute -top-6 left-0 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">
                  Region of Interest
                </div>
              </div>
            )}

            {isDrawingMode && (
              <div className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm text-foreground text-xs px-3 py-1.5 rounded-md border">
                Click and drag to draw a region
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="flex items-center justify-between gap-2 p-3 bg-card border-t">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPlayPause}
                data-testid="button-play-pause"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRestart}
                data-testid="button-restart"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1">
              {currentBox && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearBoundingBox}
                  data-testid="button-clear-box"
                >
                  <Square className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCaptureClick}
                data-testid="button-capture"
              >
                <Camera className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-testid="button-fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
);
