import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { loadYouTubeIframeAPI } from "../lib/youtube";

interface VideoPlayerProps {
  videoId: string | null;
}

export default function VideoPlayer({ videoId }: VideoPlayerProps) {
  const playerRef = useRef<YT.Player | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup = () => {};

    if (videoId && containerRef.current) {
      loadYouTubeIframeAPI().then(() => {
        if (containerRef.current) {
          playerRef.current = new YT.Player(containerRef.current, {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
              autoplay: 0,
              modestbranding: 1,
              rel: 0,
              cc_load_policy: 1
            }
          });
        }
      });

      cleanup = () => {
        if (playerRef.current) {
          playerRef.current.destroy();
        }
      };
    }

    return cleanup;
  }, [videoId]);

  return (
    <Card className="w-full h-full flex items-center justify-center bg-muted">
      {!videoId ? (
        <div className="text-muted-foreground">Enter a YouTube URL to begin</div>
      ) : (
        <div ref={containerRef} className="w-full h-full" />
      )}
    </Card>
  );
}
