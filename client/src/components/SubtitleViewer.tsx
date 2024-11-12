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
  // Average reading speed (words per minute) - Updated to 400 for more aggressive time savings
  const AVG_READING_SPEED = 400;
  
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

// Add new grouping utilities
function groupSentencesByContext(subtitles: Subtitle[]): Subtitle[][] {
  const groups: Subtitle[][] = [];
  let currentGroup: Subtitle[] = [];
  let lastEndTime = 0;

  // Helper function to detect topic changes
  function detectTopicChange(text1: string, text2: string): boolean {
    const getKeywords = (text: string): Set<string> => {
      const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against',
        'during', 'without', 'before', 'under', 'around', 'among'
      ]);
      
      return new Set(
        text.toLowerCase()
          .replace(/[.,!?;:]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 3 && !stopWords.has(word))
      );
    };

    const keywords1 = getKeywords(text1);
    const keywords2 = getKeywords(text2);
    
    // Calculate Jaccard similarity coefficient
    const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
    const union = new Set([...keywords1, ...keywords2]);
    
    return intersection.size / union.size < 0.2; // Less than 20% similarity indicates topic change
  }

  // Helper function to detect semantic transitions
  function detectSemanticTransition(text: string): boolean {
    const transitionPhrases = [
      'however', 'moreover', 'furthermore', 'in addition', 'consequently',
      'therefore', 'thus', 'hence', 'as a result', 'in conclusion',
      'finally', 'to summarize', 'in contrast', 'on the other hand',
      'alternatively', 'meanwhile', 'subsequently', 'nevertheless',
      'in fact', 'indeed', 'notably', 'specifically', 'particularly',
      'for example', 'for instance', 'in other words', 'that is'
    ];

    const lowercaseText = text.toLowerCase();
    return transitionPhrases.some(phrase => lowercaseText.startsWith(phrase));
  }

  for (let i = 0; i < subtitles.length; i++) {
    const subtitle = subtitles[i];
    const timeGap = subtitle.start - lastEndTime;
    const currentText = subtitle.text.trim();
    const previousText = currentGroup[currentGroup.length - 1]?.text || '';

    // Factors that influence grouping decisions
    const hasLongPause = timeGap > 2000; // 2 seconds pause
    const isSemanticTransition = detectSemanticTransition(currentText);
    const isTopicChange = previousText && detectTopicChange(previousText, currentText);
    const isEndOfThought = previousText.endsWith('.') || previousText.endsWith('!') || previousText.endsWith('?');
    const isOptimalGroupSize = currentGroup.length >= 3 && currentGroup.length <= 5;

    const shouldStartNewGroup = 
      currentGroup.length === 0 ||
      hasLongPause ||
      (isEndOfThought && (isSemanticTransition || isTopicChange)) ||
      (isOptimalGroupSize && isEndOfThought);

    if (shouldStartNewGroup && currentGroup.length > 0) {
      groups.push([...currentGroup]);
      currentGroup = [];
    }

    currentGroup.push(subtitle);
    lastEndTime = subtitle.end;
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function hasCommonWords(text1: string, text2: string): boolean {
  const getSignificantWords = (text: string): Set<string> => {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
    return new Set(
      text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word))
    );
  };

  const words1 = getSignificantWords(text1);
  const words2 = getSignificantWords(text2);
  
  let commonCount = 0;
  for (const word of words1) {
    if (words2.has(word)) commonCount++;
  }
  
  // Return true if at least 20% of significant words are common
  return commonCount >= Math.min(words1.size, words2.size) * 0.2;
}

function cleanAndJoinText(subtitles: Subtitle[]): string {
  return subtitles
    .map(sub => sub.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  // Add unique key generation helper
  const generateUniqueKey = (videoId: string, timestamp: number) => {
    return `${videoId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
  };

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

        // Use the current host and protocol for WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/progress`;
        const ws = new WebSocket(wsUrl, {
          credentials: 'include' 
        });
        wsRef.current = ws;

        const connectionTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            ws.close();
            reject(new Error('Connection timeout'));
            toast({
              title: "Connection Error",
              description: "Failed to establish connection with the server. Please try again.",
              variant: "destructive"
            });
          }
        }, 5000);

        ws.addEventListener('open', () => {
          clearTimeout(connectionTimeout);
          setWsConnected(true);
          setWsRetrying(false);
          setWsError(null);
          
          // Setup ping interval
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 30000);
          
          // Send initial connection message with videoId
          ws.send(JSON.stringify({ type: 'init', videoId }));
          
          resolve();
        });

        ws.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') return;

            const update: ProgressUpdate = data;
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
        });

        ws.addEventListener('error', (error) => {
          console.error('WebSocket error:', error);
          handleWebSocketError(error);
          reject(error);
        });

        ws.addEventListener('close', (event) => {
          clearTimeout(connectionTimeout);
          console.log('WebSocket closed:', event.code, event.reason);
          setWsConnected(false);
          
          // Only retry if closure wasn't intentional and not unauthorized
          if (event.code !== 1000 && event.code !== 1001 && event.code !== 1015 && retryCount < 3) {
            const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
            setWsRetrying(true);
            
            retryTimeoutRef.current = setTimeout(() => {
              setRetryCount(count => count + 1);
              connectWebSocket().catch(console.error);
            }, retryDelay);
          } else if (retryCount >= 3) {
            setWsRetrying(false);
            setWsError(new Error('Failed to maintain connection to the server'));
          }
        });
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

  const textStyles = {
    container: "p-8 space-y-8",
    textContainer: `
      prose 
      prose-zinc 
      dark:prose-invert 
      max-w-none 
      space-y-8
      [&>*]:transition-all
      [&>*]:duration-300
    `,
    paragraph: `
      relative
      group
      mb-8
      leading-[1.8]
      tracking-wide
      text-base
      text-foreground/90
      first-letter:text-xl
      first-letter:font-medium
      first-line:leading-[2]
      indent-[1.5em]
      hover:bg-primary/5
      rounded-lg
      p-8
      transition-all
      duration-300
      border-l-2
      border-transparent
      hover:border-primary/20
      hover:shadow-sm
      hover:translate-x-1
      relative
      before:content-['']
      before:absolute
      before:left-0
      before:top-0
      before:w-1
      before:h-full
      before:bg-primary/10
      before:rounded-l-lg
      before:transition-all
      before:duration-300
      hover:before:bg-primary/30
    `,
    paragraphGroup: `
      relative
      space-y-6
      rounded-xl
      bg-background/50
      p-6
      backdrop-blur-sm
      transition-all
      duration-300
      hover:bg-background/70
      border
      border-border/5
      hover:border-border/20
      shadow-sm
      hover:shadow-md
    `,
    section: "rounded-lg bg-card/50 p-8 shadow-sm border border-border/10 backdrop-blur-sm hover:bg-card/60 transition-colors duration-300",
    headingLarge: "text-2xl font-semibold mb-6 text-foreground/90 tracking-tight",
    headingMedium: "text-xl font-medium mb-4 text-foreground/80",
    sectionDivider: "my-8 border-t border-border/40 w-1/3 mx-auto opacity-50",
    timestamp: `
      absolute 
      -left-2 
      top-1/2 
      -translate-y-1/2
      px-2 
      py-1 
      text-xs 
      font-mono 
      text-muted-foreground/60
      opacity-0
      group-hover:opacity-100
      transition-opacity
      duration-300
    `,
    groupContainer: "space-y-6 relative",
  };

  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Update subtitle rendering to use unique keys
  const renderSubtitles = () => {
    if (!subtitles) return null;

    const groups = groupSentencesByContext(subtitles);
    return groups.map((group, groupIndex) => (
      <div 
        key={generateUniqueKey(videoId!, groupIndex)} 
        className="mb-4 p-4 rounded-lg bg-card"
      >
        {group.map((subtitle, index) => (
          <div 
            key={generateUniqueKey(videoId!, subtitle.start)} 
            className="text-card-foreground"
          >
            {subtitle.text}
          </div>
        ))}
      </div>
    ));
  };

  return (
    <ErrorBoundary onError={handleError}>
      <div className="p-6 animate-fade-in">
        <div className="mb-6 space-y-4">
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
          <div className={textStyles.section}>
            <Alert variant="destructive" className="mb-6 border-destructive/50 bg-destructive/10">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className={textStyles.headingMedium}>
                {wsError ? "Connection Error" : "Audio Processing Failed"}
              </AlertTitle>
              <AlertDescription className="mt-2 text-base leading-7">
                {wsError ? (
                  <p>{wsError.message || "Failed to connect to the server"}</p>
                ) : (
                  <>
                    We couldn't process the audio because:
                    <ul className="list-disc list-inside mt-3 space-y-2">
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
          <ScrollArea className="h-[500px] rounded-lg border bg-background/50 backdrop-blur-sm">
            {isValidating ? (
              <div className={textStyles.container}>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-primary text-lg">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{progressMessage || "Processing audio..."}</span>
                  </div>
                  <div className="relative">
                    <Progress 
                      value={progress} 
                      className="h-2 bg-muted transition-all duration-300"
                    />
                  </div>
                  <div className={textStyles.section}>
                    <ProgressStages stage={progressStage} substage={progressSubstage} />
                  </div>
                </div>
              </div>
            ) : subtitles && subtitles.length > 0 ? (
              <div className={textStyles.container}>
                <div className="flex items-center justify-between mb-8">
                  {/* Previous header content */}
                </div>

                <ScrollArea className="h-[600px] rounded-lg border bg-background/50 backdrop-blur-sm">
                  <div className={textStyles.textContainer}>
                    {renderSubtitles()}
                  </div>
                  {wordCount > 0 && videoDuration > 0 && (
                    <TimeSavingEstimate wordCount={wordCount} duration={videoDuration} />
                  )}
                </ScrollArea>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <p className="text-lg mb-4">✨ Transform YouTube videos into readable text</p>
                <p className="text-sm text-muted-foreground">
                  Enter a YouTube URL above to extract audio and generate transcriptions
                </p>
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </ErrorBoundary>
  );
}