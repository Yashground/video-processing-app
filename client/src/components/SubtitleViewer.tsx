import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import useSWR, { mutate } from "swr";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

interface SubtitleViewerProps {
  videoId: string | null;
}

export default function SubtitleViewer({ videoId }: SubtitleViewerProps) {
  const [selectedSubtitle, setSelectedSubtitle] = useState<Subtitle | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { toast } = useToast();
  
  const { data: subtitles, error, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onError: (err) => {
        let errorMessage = "Failed to process video audio.";
        if (err.message?.includes("Maximum content size")) {
          errorMessage = "Video is too long. Please try a shorter video (max 30 minutes).";
        } else if (err.message?.includes("no suitable")) {
          errorMessage = "Could not download audio from this video. Please try another video.";
        }
        
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive"
        });
      },
      shouldRetryOnError: false
    }
  );

  const handleRetry = () => {
    setRetryCount(count => count + 1);
    mutate(videoId ? `/api/subtitles/${videoId}` : null);
  };

  if (!videoId) {
    return (
      <Card className="h-full p-4">
        <div className="text-muted-foreground">Load a video to see subtitles</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full p-4">
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load subtitles. This might be because:
            <ul className="list-disc list-inside mt-2">
              <li>The video is too long (max 30 minutes)</li>
              <li>The video is not accessible</li>
              <li>There was an error processing the audio</li>
            </ul>
          </AlertDescription>
        </Alert>
        <Button onClick={handleRetry} className="w-full">
          Try Again
        </Button>
      </Card>
    );
  }

  return (
    <Card className="h-full p-4">
      <ScrollArea className="h-full">
        <div className="space-y-2">
          {isValidating ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing video audio...
              </div>
              <Alert>
                <AlertTitle>Processing Large Video</AlertTitle>
                <AlertDescription>
                  This might take a few minutes for longer videos. Please wait...
                </AlertDescription>
              </Alert>
            </div>
          ) : subtitles ? (
            subtitles.map((subtitle, index) => (
              <div
                key={index}
                className={`p-2 rounded cursor-pointer hover:bg-secondary ${
                  selectedSubtitle === subtitle ? "bg-secondary" : ""
                }`}
                onClick={() => setSelectedSubtitle(subtitle)}
              >
                <p className="text-sm text-muted-foreground">
                  {new Date(subtitle.start).toISOString().substr(11, 8)}
                </p>
                <p className="text-foreground">{subtitle.text}</p>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground">No subtitles available</div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
