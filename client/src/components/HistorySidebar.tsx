import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import useSWR, { mutate } from "swr";
import { Clock, Loader2, Video, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VideoMetadata {
  videoId: string;
  title: string | null;
}

interface HistorySidebarProps {
  onVideoSelect: (videoId: string) => void;
  selectedVideoId: string | null;
  className?: string;
}

export default function HistorySidebar({ onVideoSelect, selectedVideoId, className }: HistorySidebarProps) {
  const { data: videos, isLoading } = useSWR<VideoMetadata[]>('/api/videos');
  const { toast } = useToast();

  const clearHistory = async () => {
    try {
      const response = await fetch('/api/videos', {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to clear history');
      }

      // Refresh the videos list
      await mutate('/api/videos');
      
      toast({
        title: "History Cleared",
        description: "Your video history has been cleared successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear history. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className={cn("w-80 border-r bg-muted/10", className)}>
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">History</h2>
          </div>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">History</h2>
          </div>
          {videos && videos.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearHistory}
              className="flex items-center gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          )}
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
              <div className="flex items-start gap-3">
                <Video className="h-5 w-5 mt-1 text-primary/60 flex-shrink-0" />
                <h3 className="text-lg font-medium leading-snug">
                  {video.title || `Video ${video.videoId}`}
                </h3>
              </div>
            </Card>
          ))}
          {videos?.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Video className="h-8 w-8 mx-auto mb-3 text-primary/40" />
              <p>No videos in history</p>
              <p className="text-sm mt-1">Process a video to see it here</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
