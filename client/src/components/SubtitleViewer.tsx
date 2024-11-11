import { useEffect, useState, useRef, Component, ErrorInfo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import useSWR, { mutate } from "swr";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, Globe, RefreshCw, Wifi, WifiOff, Clock } from "lucide-react";
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
  stage: 'download' | 'processing' | 'transcription' | 'initialization' | 'analysis' | 'cleanup';
  progress: number;
  message?: string;
  error?: string;
  substage?: string;
}

interface SubtitleViewerProps {
  videoId: string | null;
  onTextUpdate?: (text: string) => void;
}

class ErrorBoundary extends Component<{ children: React.ReactNode, onError: (error: Error) => void }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode, onError: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SubtitleViewer error:', error, errorInfo);
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            An error occurred while displaying subtitles. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
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

function ProgressStages({ stage, substage }: { stage: string, substage?: string }) {
  const stages = [
    { id: 'initialization', label: 'Initializing process', subLabel: 'Setting up processing environment' },
    { id: 'download', label: 'Downloading from YouTube', subLabel: 'Fetching audio content' },
    { id: 'analysis', label: 'Analyzing audio', subLabel: 'Preparing for transcription' },
    { id: 'processing', label: 'Processing audio', subLabel: 'Optimizing audio quality' },
    { id: 'transcription', label: 'Transcribing content', subLabel: 'Converting speech to text' },
    { id: 'cleanup', label: 'Finalizing', subLabel: 'Cleaning up temporary files' }
  ];

  const currentStageIndex = stages.findIndex(s => s.id === stage);

  return (
    <div className="space-y-3">
      {stages.map((s, index) => (
        <div
          key={s.id}
          className={`flex items-start gap-3 transition-colors duration-300 ${
            s.id === stage ? 'text-primary font-medium' : 
            index < currentStageIndex ? 'text-muted-foreground' : ''
          }`}
        >
          <div className={`w-2 h-2 mt-2 rounded-full ${
            s.id === stage ? 'bg-primary animate-pulse' :
            index < currentStageIndex ? 'bg-muted-foreground' : 'bg-muted'
          }`} />
          <div>
            <div>{s.label}</div>
            {s.id === stage && substage ? (
              <div className="text-sm text-muted-foreground mt-1">{substage}</div>
            ) : (
              <div className="text-sm text-muted-foreground mt-1">{s.subLabel}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionStatus({ connected, retrying, onRetry }: { connected: boolean; retrying: boolean; onRetry: () => void }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
      connected ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'
    }`}>
      {connected ? (
        <>
          <Wifi className="h-4 w-4" />
          <span>Connected</span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>{retrying ? 'Reconnecting...' : 'Disconnected'}</span>
          {!retrying && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="ml-2 h-6 px-2 hover:bg-destructive/20"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function TimeSavingEstimate({ wordCount, duration }: { wordCount: number; duration: number }) {
  // Average reading speed (words per minute)
  const AVG_READING_SPEED = 250;
  
  // Calculate reading time in minutes
  const readingTime = wordCount / AVG_READING_SPEED;
  
  // Calculate video duration in minutes
  const videoDuration = duration / 60;
  
  // Calculate time saved in minutes
  const timeSaved = Math.max(0, videoDuration - readingTime);
  
  return (
    <div className="flex items-center gap-2 text-primary">
      <Clock className="h-5 w-5" />
      <span className="font-medium">
        {timeSaved.toFixed(1)} minutes saved compared to watching
      </span>
      <div className="text-sm text-muted-foreground">
        ({Math.ceil(readingTime)} min read vs {Math.ceil(videoDuration)} min video)
      </div>
    </div>
  );
}

export default function SubtitleViewer({ videoId, onTextUpdate }: SubtitleViewerProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressStage, setProgressStage] = useState<string>("");
  const [progressSubstage, setProgressSubstage] = useState<string>("");
  const [wsError, setWsError] = useState<Error | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsRetrying, setWsRetrying] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();
  
  const { data: subtitles, error, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onSuccess: (data) => {
        if (data && data.length > 0) {
          // Calculate word count from all subtitles
          const text = data.map(sub => sub.text.trim()).join(' ');
          setWordCount(text.split(/\s+/).length);
          
          // Get video duration from the last subtitle's end time
          const lastSubtitle = data[data.length - 1];
          setVideoDuration(lastSubtitle.end / 1000); // Convert ms to seconds
        }
      },
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

  const cleanupWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close(1000, "Cleanup");
      wsRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    setWsConnected(false);
    setWsRetrying(false);
  };

  const handleWebSocketError = (error: Event | Error) => {
    console.error('WebSocket error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Connection error occurred';
    setWsError(new Error(errorMessage));
    setWsConnected(false);
  };

  const connectWebSocket = () => {
    if (!videoId) return Promise.reject(new Error('No video ID provided'));
    
    return new Promise<void>((resolve, reject) => {
      try {
        cleanupWebSocket();
        setWsRetrying(true);

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/progress`);
        wsRef.current = ws;

        const connectionTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 5000);

        ws.onopen = () => {
          clearTimeout(connectionTimeout);
          setWsConnected(true);
          setWsRetrying(false);
          setWsError(null);
          
          // Setup ping interval
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('ping');
            }
          }, 30000);
          
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const update: ProgressUpdate = JSON.parse(event.data);
            if (update.videoId === videoId) {
              if (update.error) {
                setWsError(new Error(update.error));
                toast({
                  title: "Processing Error",
                  description: update.error,
                  variant: "destructive"
                });
              } else {
                setProgress(update.progress);
                setProgressMessage(update.message || "");
                setProgressStage(update.stage);
                setProgressSubstage(update.substage || "");
                setWsError(null);
              }
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            handleWebSocketError(error);
          }
        };

        ws.onerror = handleWebSocketError;

        ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          console.log('WebSocket closed:', event.code, event.reason);
          setWsConnected(false);
          
          // Only retry if closure wasn't intentional
          if (event.code !== 1000 && retryCount < 3) {
            const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
            setWsRetrying(true);
            
            retryTimeoutRef.current = setTimeout(() => {
              setRetryCount(count => count + 1);
              connectWebSocket().catch(reject);
            }, retryDelay);
          } else if (retryCount >= 3) {
            setWsRetrying(false);
            setWsError(new Error('Failed to maintain connection to the server'));
            reject(new Error('Maximum retry attempts reached'));
          }
        };
      } catch (error) {
        console.error('Error establishing WebSocket connection:', error);
        reject(error);
      }
    });
  };

  // WebSocket connection effect
  useEffect(() => {
    if (!videoId) return;

    connectWebSocket().catch((error) => {
      console.error('Failed to establish WebSocket connection:', error);
      toast({
        title: "Connection Error",
        description: "Failed to connect to the progress tracking server. Please try refreshing the page.",
        variant: "destructive"
      });
    });

    return cleanupWebSocket;
  }, [videoId, retryCount]);

  const handleRetry = () => {
    setRetryCount(0);
    setProgress(0);
    setProgressMessage("");
    setProgressStage("");
    setProgressSubstage("");
    setWsError(null);
    mutate(videoId ? `/api/subtitles/${videoId}` : null);
    
    if (!wsConnected) {
      connectWebSocket().catch(console.error);
    }
  };

  const getLanguageName = (code?: string) => {
    if (!code) return "Unknown";
    return languageNames[code.toLowerCase()] || code;
  };

  const handleError = (error: Error) => {
    console.error('SubtitleViewer error:', error);
    toast({
      title: "Error",
      description: "An error occurred while displaying subtitles. Please try refreshing the page.",
      variant: "destructive"
    });
  };

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground text-lg animate-fade-in">
        <p className="mb-4">✨ Transform YouTube videos into readable text</p>
        <p className="text-sm text-muted-foreground">
          Enter a YouTube URL above to extract audio, generate transcriptions, and save time by reading instead of watching
        </p>
      </div>
    );
  }

  return (
    <ErrorBoundary onError={handleError}>
      <div className="p-6 animate-fade-in">
        <div className="mb-4 space-y-4">
          <div className="flex items-center justify-between">
            {subtitles?.[0]?.language && (
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <Badge variant="secondary" className="bg-gradient-to-r from-primary/10 to-primary/5 text-primary px-3 py-1">
                  {getLanguageName(subtitles[0].language)}
                </Badge>
              </div>
            )}
            <ConnectionStatus
              connected={wsConnected}
              retrying={wsRetrying}
              onRetry={handleRetry}
            />
          </div>
          
          {subtitles && !error && !isValidating && (
            <TimeSavingEstimate wordCount={wordCount} duration={videoDuration} />
          )}
        </div>

        {error || wsError ? (
          <div className="space-y-6">
            <Alert variant="destructive" className="mb-6 border-destructive/50 bg-destructive/10">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="text-lg font-semibold">
                {wsError ? "Connection Error" : "Audio Processing Failed"}
              </AlertTitle>
              <AlertDescription className="mt-2 text-base">
                {wsError ? (
                  <p>{wsError.message || "Failed to connect to the server"}</p>
                ) : (
                  <>
                    We couldn't process the audio because:
                    <ul className="list-disc list-inside mt-3 space-y-1">
                      <li>The video might be too long (max 2 hours)</li>
                      <li>The file might be too large (max 100MB)</li>
                      <li>The video might be private or unavailable</li>
                      <li>There might be an issue with the audio extraction</li>
                    </ul>
                  </>
                )}
              </AlertDescription>
            </Alert>
            <Button 
              onClick={handleRetry} 
              className="w-full h-11 text-base bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary transition-all duration-300"
            >
              <RefreshCw className="mr-2 h-5 w-5" />
              Try {wsError ? "Reconnecting" : "Processing"} Again
            </Button>
          </div>
        ) : (
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
                  <AlertTitle className="text-lg font-semibold mb-4">Processing Progress</AlertTitle>
                  <AlertDescription className="text-base">
                    <ProgressStages stage={progressStage} substage={progressSubstage} />
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
        )}
      </div>
    </ErrorBoundary>
  );
}