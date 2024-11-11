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
  onTextUpdate?: (text: string) => void;
}

export default function SubtitleViewer({ videoId, onTextUpdate }: SubtitleViewerProps) {
  const [retryCount, setRetryCount] = useState(0);
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

  const handleRetry = () => {
    setRetryCount(count => count + 1);
    mutate(videoId ? `/api/subtitles/${videoId}` : null);
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Enter a YouTube URL above to extract audio and generate subtitles
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Audio Processing Failed</AlertTitle>
          <AlertDescription>
            We couldn't process the audio because:
            <ul className="list-disc list-inside mt-2">
              <li>The video might be too long (max 30 minutes)</li>
              <li>The video might be private or unavailable</li>
              <li>There might be an issue with the audio extraction</li>
            </ul>
          </AlertDescription>
        </Alert>
        <Button onClick={handleRetry} className="w-full">
          Try Processing Again
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <ScrollArea className="h-[400px]">
        {isValidating ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting and Processing Audio...
            </div>
            <Alert>
              <AlertTitle>Processing Audio</AlertTitle>
              <AlertDescription>
                We're currently:
                <ul className="list-disc list-inside mt-2">
                  <li>Downloading the audio from YouTube</li>
                  <li>Converting it to the right format</li>
                  <li>Generating subtitles using AI</li>
                </ul>
                This might take a few minutes depending on the video length.
              </AlertDescription>
            </Alert>
          </div>
        ) : subtitles ? (
          <div className="prose prose-sm max-w-none dark:prose-invert">
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
                <p key={index} className="mb-4">
                  {paragraph.join(' ')}
                </p>
              ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">No content available</div>
        )}
      </ScrollArea>
    </div>
  );
}
