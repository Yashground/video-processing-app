import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import useSWR from "swr";
import { useToast } from "@/hooks/use-toast";

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
  
  const { data: subtitles, error } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null,
    {
      onError: (err) => {
        toast({
          title: "Error",
          description: "Failed to load subtitles. Please make sure the video has closed captions available.",
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
          {subtitles ? (
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
            <div className="text-muted-foreground">Loading subtitles...</div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
