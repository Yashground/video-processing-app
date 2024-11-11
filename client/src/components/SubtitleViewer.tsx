import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import useSWR from "swr";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

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
  const { toast } = useToast();
  
  const { data: subtitles, error, isValidating } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onError: (err) => {
        toast({
          title: "Error",
          description: "Failed to process video audio. Please try again.",
          variant: "destructive"
        });
      }
    }
  );

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
        <div className="text-destructive">Failed to load subtitles</div>
      </Card>
    );
  }

  return (
    <Card className="h-full p-4">
      <ScrollArea className="h-full">
        <div className="space-y-2">
          {isValidating && !subtitles ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing video audio...
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
