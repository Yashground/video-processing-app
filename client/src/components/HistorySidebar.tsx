import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import useSWR from "swr";
import { Clock, Loader2 } from "lucide-react";

interface Video {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  createdAt: string;
}

interface HistorySidebarProps {
  onVideoSelect: (videoId: string) => void;
  selectedVideoId: string | null;
  className?: string;
}

export default function HistorySidebar({ onVideoSelect, selectedVideoId, className }: HistorySidebarProps) {
  const { data: videos, isLoading } = useSWR<Video[]>('/api/videos');

  if (isLoading) {
    return (
      <div className={cn("w-80 border-r bg-muted/10 p-4", className)}>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5" />
          <h2 className="text-lg font-semibold">History</h2>
        </div>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-80 border-r bg-muted/10", className)}>
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          <h2 className="text-lg font-semibold">History</h2>
        </div>
      </div>
      <ScrollArea className="h-[calc(100vh-5rem)]">
        <div className="p-2 space-y-2">
          {videos?.map((video) => (
            <Card
              key={video.videoId}
              className={cn(
                "p-2 cursor-pointer transition-all duration-200 hover:shadow-md",
                selectedVideoId === video.videoId && "border-primary bg-primary/5"
              )}
              onClick={() => onVideoSelect(video.videoId)}
            >
              <div className="aspect-video relative mb-2 rounded-sm overflow-hidden">
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  className="object-cover w-full h-full"
                />
              </div>
              <h3 className="text-sm font-medium line-clamp-2">{video.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(video.createdAt).toLocaleDateString()}
              </p>
            </Card>
          ))}
          {videos?.length === 0 && (
            <div className="p-4 text-center text-muted-foreground">
              No videos in history
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
