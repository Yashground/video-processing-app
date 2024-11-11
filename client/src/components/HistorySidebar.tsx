import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import useSWR from "swr";
import { Clock, Loader2 } from "lucide-react";

interface Video {
  videoId: string;
  title: string;
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
      <div className={cn("w-80 border-r bg-muted/10 p-6", className)}>
        <div className="flex items-center gap-3 mb-6">
          <Clock className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">History</h2>
        </div>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-80 border-r bg-muted/10", className)}>
      <div className="p-6 border-b">
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">History</h2>
        </div>
      </div>
      <ScrollArea className="h-[calc(100vh-5rem)]">
        <div className="p-4 space-y-3">
          {videos?.map((video) => (
            <Card
              key={video.videoId}
              className={cn(
                "p-4 cursor-pointer transition-all duration-200",
                "hover:bg-primary/5 hover:shadow-sm",
                selectedVideoId === video.videoId && "border-2 border-primary bg-primary/10"
              )}
              onClick={() => onVideoSelect(video.videoId)}
            >
              <h3 className="text-lg font-medium line-clamp-2 leading-tight">
                {video.title}
              </h3>
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