import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import useSWR from "swr";

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
  
  const { data: subtitles, error } = useSWR<Subtitle[]>(
    videoId ? `/api/subtitles/${videoId}` : null
  );

  if (error) {
    return (
      <Card className="h-full p-4">
        <div className="text-destructive">Failed to load subtitles</div>
      </Card>
    );
  }

  if (!videoId) {
    return (
      <Card className="h-full p-4">
        <div className="text-muted-foreground">Load a video to see subtitles</div>
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
                  {new Date(subtitle.start * 1000).toISOString().substr(11, 8)}
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
