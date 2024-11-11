import { useEffect, useState, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import useSWR, { mutate } from "swr";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, Globe, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface Subtitle {
  start: number;
  end: number;
  text: string;
  language?: string;
}

interface ProgressUpdate {
  videoId: string;
  stage: 'download' | 'processing' | 'transcription';
  progress: number;
  message?: string;
  error?: string;
}

interface SubtitleViewerProps {
  videoId: string | null;
  onTextUpdate?: (text: string) => void;
}

const languageNames: { [key: string]: string } = {
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese"
};

export default function SubtitleViewer({ videoId, onTextUpdate }: SubtitleViewerProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressStage, setProgressStage] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  
  const { data: subtitles, error, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onError: (err) => {
        let errorMessage = "Failed to process audio.";
        if (err.message?.includes("too large") || err.message?.includes("maxFilesize")) {
          errorMessage = "Audio file is too large (max 100MB). Please try a shorter video.";
        } else if (err.message?.includes("duration") || err.message?.includes("maximum limit")) {
          errorMessage = "Video is too long. Maximum supported duration is 2 hours.";
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

  // WebSocket connection for progress updates
  useEffect(() => {
    if (!videoId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const maxRetries = 3;
    let retryCount = 0;
    let retryTimeout: NodeJS.Timeout;
    
    function connect() {
      const ws = new WebSocket(`${protocol}//${window.location.host}/progress`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const update: ProgressUpdate = JSON.parse(event.data);
          if (update.videoId === videoId) {
            if (update.error) {
              toast({
                title: "Processing Error",
                description: update.error,
                variant: "destructive"
              });
            } else {
              setProgress(update.progress);
              setProgressMessage(update.message || "");
              setProgressStage(update.stage);
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onopen = () => {
        console.log('WebSocket connected');
        retryCount = 0; // Reset retry count on successful connection
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        
        // Only retry if we haven't reached max retries and the closure wasn't intentional
        if (retryCount < maxRetries && event.code !== 1000) {
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          console.log(`Retrying connection in ${retryDelay}ms...`);
          
          retryTimeout = setTimeout(() => {
            retryCount++;
            connect();
          }, retryDelay);
        } else if (retryCount >= maxRetries) {
          toast({
            title: "Connection Error",
            description: "Failed to maintain connection to the server. Please refresh the page.",
            variant: "destructive"
          });
        }
      };
    }

    connect();

    // Cleanup function
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [videoId, toast]);

  const handleRetry = () => {
    setRetryCount(count => count + 1);
    setProgress(0);
    setProgressMessage("");
    setProgressStage("");
    mutate(videoId ? `/api/subtitles/${videoId}` : null);
  };

  const getLanguageName = (code?: string) => {
    if (!code) return "Unknown";
    return languageNames[code.toLowerCase()] || code;
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg animate-fade-in">
        Enter a YouTube URL above to extract audio and generate subtitles
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 animate-fade-in">
        <Alert variant="destructive" className="mb-6 border-destructive/50 bg-destructive/10">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle className="text-lg font-semibold">Audio Processing Failed</AlertTitle>
          <AlertDescription className="mt-2 text-base">
            We couldn't process the audio because:
            <ul className="list-disc list-inside mt-3 space-y-1">
              <li>The video might be too long (max 2 hours)</li>
              <li>The file might be too large (max 100MB)</li>
              <li>The video might be private or unavailable</li>
              <li>There might be an issue with the audio extraction</li>
            </ul>
          </AlertDescription>
        </Alert>
        <Button 
          onClick={handleRetry} 
          className="w-full h-11 text-base bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary transition-all duration-300"
        >
          <RefreshCw className="mr-2 h-5 w-5" />
          Try Processing Again
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      {subtitles?.[0]?.language && (
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-5 w-5 text-primary" />
          <Badge variant="secondary" className="bg-gradient-to-r from-primary/10 to-primary/5 text-primary px-3 py-1">
            {getLanguageName(subtitles[0].language)}
          </Badge>
        </div>
      )}
      
      <ScrollArea className="h-[500px]">
        {isValidating ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3 text-primary text-lg">
              <Loader2 className="h-5 w-5 animate-spin" />
              {progressMessage || "Processing Audio..."}
            </div>
            <div className="relative">
              <Progress 
                value={progress} 
                className="h-2 bg-primary/20 transition-all duration-300"
              />
            </div>
            <Alert className="bg-muted/50 border-primary/20">
              <AlertTitle className="text-lg font-semibold mb-2">Processing Steps</AlertTitle>
              <AlertDescription className="text-base space-y-4">
                <ul className="list-disc list-inside space-y-2">
                  <li className={`transition-colors duration-300 ${progressStage === 'download' ? 'text-primary' : progress > 30 ? "text-muted-foreground" : ""}`}>
                    Downloading audio from YouTube
                  </li>
                  <li className={`transition-colors duration-300 ${progressStage === 'processing' ? 'text-primary' : progress > 50 ? "text-muted-foreground" : ""}`}>
                    Preparing audio for processing
                  </li>
                  <li className={`transition-colors duration-300 ${progressStage === 'transcription' ? 'text-primary' : progress > 70 ? "text-muted-foreground" : ""}`}>
                    Detecting language and transcribing
                  </li>
                  <li className={progress === 100 ? "text-primary" : ""}>
                    Generating final transcription
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground mt-4">
                  This process might take several minutes for longer videos.
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
                <p 
                  key={index} 
                  className="mb-6 leading-relaxed transition-colors duration-200 hover:text-primary/90 cursor-default"
                >
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