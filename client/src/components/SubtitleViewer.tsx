import { useEffect, useState, useRef, Component, ErrorInfo, useCallback } from "react";
import ReconnectingWebSocket from 'reconnecting-websocket';
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
  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const { toast } = useToast();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const maxRetries = 5;
  const reconnectDelay = 2000;

  // Add SWR hook for subtitles data with proper error handling and fallback
  const { data: subtitles = [], error: subtitlesError, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      fallbackData: [],
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const handleWebSocketError = useCallback((error: Error) => {
    console.error('WebSocket error:', error);
    setWsError(error);
    toast({
      title: "Connection Error",
      description: "Attempting to reconnect...",
      variant: "destructive",
    });
  }, [toast]);

  // Updated WebSocket Configuration with enhanced reconnection strategy
  const WS_CONFIG = {
    connectionTimeout: 8000, // Reduced from 10000
    maxRetries: 5,
    minReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    reconnectionDelayGrowFactor: 2,
    debug: process.env.NODE_ENV === 'development',
    timeoutInterval: 5000,
    maxEnqueuedMessages: 50,
  };

  const { data: user, error: authError, mutate: mutateUser } = useSWR('/api/user');
  const isAuthenticated = !!user && !authError;

  const handleReconnect = useCallback(() => {
    if (!wsRef.current || retryCount >= WS_CONFIG.maxRetries) {
      setWsRetrying(false);
      return;
    }
    
    setWsRetrying(true);
    const delay = Math.min(
      WS_CONFIG.minReconnectionDelay * Math.pow(WS_CONFIG.reconnectionDelayGrowFactor, retryCount),
      WS_CONFIG.maxReconnectionDelay
    );
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    reconnectTimeoutRef.current = setTimeout(() => {
      if (wsRef.current) {
        console.log(`Attempting reconnection ${retryCount + 1}/${WS_CONFIG.maxRetries}`);
        wsRef.current.reconnect();
        setRetryCount(prev => prev + 1);
      }
    }, delay);
  }, [retryCount]);

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'Normal closure');
      wsRef.current = null;
    }
    setWsConnected(false);
    setWsRetrying(false);
  }, []);

  // Update the getWebSocketUrl function to handle port correctly
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/ws/progress`;
  }, []);

  // Update WebSocket initialization
  const connectWebSocket = useCallback(() => {
    if (!videoId || !isAuthenticated || wsRef.current) return;

    cleanup();
  
    const wsUrl = getWebSocketUrl();
    console.log('Connecting to WebSocket:', wsUrl);
  
    try {
      const ws = new ReconnectingWebSocket(wsUrl, [], {
        connectionTimeout: 10000,
        maxRetries: 5,
        debug: process.env.NODE_ENV === 'development',
        startClosed: false,
        minReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxEnqueuedMessages: 50,
      });
    
      wsRef.current = ws;
  
      ws.addEventListener('open', () => {
        console.log('WebSocket connection established');
        setWsConnected(true);
        setWsRetrying(false);
        setWsError(null);
        setRetryCount(0);
  
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'init',
            videoId,
            timestamp: Date.now()
          }));
        }
      });
  
      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
        
          if (data.type === 'error') {
            handleWebSocketError(new Error(data.message || 'Unknown WebSocket error'));
            return;
          }

          if (data.type === 'auth_error') {
            console.log('Authentication error, attempting to refresh session');
            mutateUser()
              .then(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  cleanup();
                  connectWebSocket();
                }
              })
              .catch(() => {
                console.error('Failed to refresh authentication');
                cleanup();
              });
            return;
          }
  
          if (data.type === 'progress') {
            setProgress(data.progress);
            setProgressMessage(data.message || '');
            setProgressStage(data.stage);
            setProgressSubstage(data.substage || '');
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });
  
      ws.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        handleWebSocketError(error instanceof Error ? error : new Error('WebSocket connection error'));
      });
  
      ws.addEventListener('close', (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setWsConnected(false);
      
        if (event.code !== 1000) {
          handleReconnect();
        }
      });
  
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      handleWebSocketError(error instanceof Error ? error : new Error('Failed to create WebSocket connection'));
    }
  }, [videoId, isAuthenticated, cleanup, getWebSocketUrl, handleWebSocketError, handleReconnect, mutateUser]);

  useEffect(() => {
    connectWebSocket();
    return cleanup;
  }, [connectWebSocket, cleanup]);

  // Add useEffect for updating text when subtitles change
  useEffect(() => {
    if (subtitles?.length && onTextUpdate) {
      const fullText = subtitles.map(s => s.text).join(' ');
      onTextUpdate(fullText);
      setWordCount(fullText.split(/\s+/).length);
    }
  }, [subtitles, onTextUpdate]);

  if (subtitlesError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load subtitles. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  if (!videoId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Enter a YouTube URL to start processing
      </div>
    );
  }

  const subtitleGroups = groupSentencesByContext(subtitles || []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Video Transcription</h2>
        <ConnectionStatus 
          connected={wsConnected} 
          retrying={wsRetrying}
          onRetry={connectWebSocket}
        />
      </div>

      {progress > 0 && progress < 100 && (
        <div className="space-y-4">
          <Progress value={progress} />
          <ProgressStages stage={progressStage} substage={progressSubstage} />
        </div>
      )}

      {isValidating && !subtitles?.length ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : subtitles?.length > 0 ? (
        <>
          {wordCount > 0 && videoDuration > 0 && (
            <TimeSavingEstimate wordCount={wordCount} duration={videoDuration} />
          )}
          <ScrollArea className="h-[600px] rounded-md border p-4">
            {subtitleGroups.map((group, groupIndex) => (
              <div 
                key={groupIndex} 
                className="mb-6 p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
              >
                {group.map((subtitle, index) => (
                  <div key={index} className="mb-2">
                    <div className="text-base leading-relaxed">
                      {subtitle.text}
                      {subtitle.language && (
                        <Badge variant="outline" className="ml-2">
                          <Globe className="h-3 w-3 mr-1" />
                          {languageNames[subtitle.language] || subtitle.language}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </ScrollArea>
        </>
      ) : null}
    </div>
  );
}