import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import useSWR, { mutate } from "swr";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface Subtitle {
  start: number;
  end: number;
  text: string;
}

interface SubtitleViewerProps {
  videoId: string | null;
  onTextUpdate?: (text: string) => void;
}

export default function SubtitleViewer({ videoId, onTextUpdate }: SubtitleViewerProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  
  const { data: subtitles, error, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onError: (err) => {
        let errorMessage = "Failed to process audio.";
        if (err.message?.includes("too large") || err.message?.includes("maxFilesize")) {
          errorMessage = "Audio file is too large. Please try a shorter video.";
        } else if (err.message?.includes("duration") || err.message?.includes("maximum limit")) {
          errorMessage = "Video is too long. Please try a shorter video (max 30 minutes).";
        } else if (err.message?.includes("unavailable") || err.message?.includes("private")) {
          errorMessage = "Video is unavailable or private. Please try another video.";
        }
        
        toast({
          title: "Audio Processing Error",
          description: errorMessage,
          variant: "destructive"
        });
      },
      shouldRetryOnError: false
    }
  );

  useEffect(() => {
    if (subtitles && onTextUpdate) {
      const fullText = subtitles
        .map(sub => sub.text.trim())
        .join(' ')
        .replace(/\s+/g, ' ');
      onTextUpdate(fullText);
    }
  }, [subtitles, onTextUpdate]);

  // Simulate progress during processing
  useEffect(() => {
    if (isValidating) {
      const interval = setInterval(() => {
        setProgress(p => {
          if (p >= 90) return p;
          return p + 1;
        });
      }, 500);
      return () => clearInterval(interval);
    } else {
      setProgress(0);
    }
  }, [isValidating]);

  const handleRetry = () => {
    setRetryCount(count => count + 1);
    setProgress(0);
    mutate(videoId ? `/api/subtitles/${videoId}` : null);
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg">
        Enter a YouTube URL above to extract audio and generate subtitles
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle className="text-lg font-semibold">Audio Processing Failed</AlertTitle>
          <AlertDescription className="mt-2 text-base">
            We couldn't process the audio because:
            <ul className="list-disc list-inside mt-3 space-y-1">
              <li>The video might be too long (max 30 minutes)</li>
              <li>The video might be private or unavailable</li>
              <li>There might be an issue with the audio extraction</li>
            </ul>
          </AlertDescription>
        </Alert>
        <Button onClick={handleRetry} className="w-full h-11 text-base">
          Try Processing Again
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ScrollArea className="h-[500px]">
        {isValidating ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3 text-primary text-lg">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing Audio...
            </div>
            <Progress value={progress} className="h-2" />
            <Alert className="bg-muted">
              <AlertTitle className="text-lg font-semibold mb-2">Processing Steps</AlertTitle>
              <AlertDescription className="text-base space-y-4">
                <ul className="list-disc list-inside space-y-2">
                  <li className={progress > 30 ? "text-muted-foreground" : ""}>
                    Downloading the audio from YouTube
                  </li>
                  <li className={progress > 60 ? "text-muted-foreground" : ""}>
                    Converting audio format
                  </li>
                  <li>Generating transcription using AI</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-4">
                  This might take a few minutes depending on the video length.
                </p>
              </AlertDescription>
            </Alert>
          </div>
        ) : subtitles ? (
          <div className="prose prose-lg max-w-none dark:prose-invert">
            {subtitles
              .reduce((acc, subtitle) => {
                const lastParagraph = acc[acc.length - 1] || [];
                if (lastParagraph.length < 5) {
                  lastParagraph.push(subtitle.text);
                  if (acc.length === 0) acc.push(lastParagraph);
                } else {
                  acc.push([subtitle.text]);
                }
                return acc;
              }, [] as string[][])
              .map((paragraph, index) => (
                <p key={index} className="mb-6 leading-relaxed">
                  {paragraph.join(' ')}
                </p>
              ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-lg">
            No content available
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
