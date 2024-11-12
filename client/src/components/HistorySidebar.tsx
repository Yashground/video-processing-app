import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import useSWR, { mutate } from "swr";
import { Clock, Loader2, Video, Trash2, Download, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface VideoMetadata {
  videoId: string;
  title: string | null;
  timeSaved?: number;
  createdAt: string;
}

interface HistoryResponse {
  videos: VideoMetadata[];
  totalTimeSaved: number;
}

interface HistorySidebarProps {
  onVideoSelect: (videoId: string) => void;
  selectedVideoId: string | null;
  className?: string;
}

export default function HistorySidebar({ onVideoSelect, selectedVideoId, className }: HistorySidebarProps) {
  const { data, isLoading } = useSWR<HistoryResponse>('/api/videos');
  const { toast } = useToast();

  const clearHistory = async () => {
    try {
      const response = await fetch('/api/videos', {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to clear history');
      }

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

  const exportHistory = async () => {
    try {
      const response = await fetch('/api/videos/export');
      
      if (!response.ok) {
        throw new Error('Failed to export history');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `video-history-export-${new Date().toISOString().split('T')[0]}.json`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "History Exported",
        description: "Your video history has been exported successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export history. Please try again.",
        variant: "destructive",
      });
    }
  };

  const deleteVideo = async (videoId: string) => {
    try {
      const response = await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete video');
      }

      await mutate('/api/videos');
      
      toast({
        title: "Video Deleted",
        description: "The video has been removed from history.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete video. Please try again.",
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
      <div className="p-6 border-b space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">History</h2>
          </div>
          {data?.videos && data.videos.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportHistory}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear History</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all videos from your history. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={clearHistory}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Clear History
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        {data?.totalTimeSaved ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-md text-primary">
            <Clock className="h-5 w-5" />
            <span className="font-medium">
              {Math.round(data.totalTimeSaved)} minutes saved in total
            </span>
          </div>
        ) : null}
      </div>
      <ScrollArea className="h-[calc(100vh-7rem)]">
        <div className="p-4 space-y-3">
          {data?.videos?.map((video) => (
            <Card
              key={`${video.videoId}-${video.createdAt}`}
              className={cn(
                "p-4 transition-all duration-200",
                "hover:bg-primary/5 hover:shadow-sm",
                selectedVideoId === video.videoId && "border-2 border-primary bg-primary/10"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div 
                  className="flex-1 cursor-pointer" 
                  onClick={() => onVideoSelect(video.videoId)}
                >
                  <div className="flex items-start gap-3">
                    <Video className="h-5 w-5 mt-1 text-primary/60 flex-shrink-0" />
                    <div className="space-y-1">
                      <h3 className="text-lg font-medium leading-snug">
                        {video.title || `Video ${video.videoId}`}
                      </h3>
                      {video.timeSaved && (
                        <p className="text-sm text-muted-foreground">
                          {Math.round(video.timeSaved)} minutes saved
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => deleteVideo(video.videoId)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
          {!data?.videos?.length && (
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