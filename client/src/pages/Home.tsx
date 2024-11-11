import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import SubtitleViewer from "../components/SubtitleViewer";
import TranslationPanel from "../components/TranslationPanel";
import { useToast } from "@/hooks/use-toast";

const urlSchema = z.object({
  videoUrl: z.string().url().refine((url) => {
    try {
      const parsed = new URL(url);
      // Support both youtube.com and youtu.be URLs
      if (parsed.hostname === "youtu.be") {
        return parsed.pathname.length > 1; // Must have video ID after /
      }
      if (parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube.com") {
        return !!parsed.searchParams.get("v"); // Must have video ID parameter
      }
      return false;
    } catch {
      return false;
    }
  }, "Please enter a valid YouTube URL")
});

export default function Home() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      videoUrl: ""
    }
  });

  const onSubmit = (data: z.infer<typeof urlSchema>) => {
    try {
      const url = new URL(data.videoUrl);
      let id: string | null = null;

      if (url.hostname === "youtu.be") {
        // Handle youtu.be URLs
        id = url.pathname.slice(1);
      } else {
        // Handle youtube.com URLs
        id = url.searchParams.get("v");
      }

      if (id) {
        setVideoId(id);
      } else {
        toast({
          title: "Invalid URL",
          description: "Could not extract video ID from the URL",
          variant: "destructive"
        });
      }
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to parse video URL",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="container mx-auto p-4 min-h-screen flex flex-col gap-4">
      <Card className="p-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
            <FormField
              control={form.control}
              name="videoUrl"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input 
                      placeholder="Enter YouTube URL (e.g., youtube.com/watch?v=... or youtu.be/...)" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Process Audio</Button>
          </form>
        </Form>
      </Card>

      <div className="flex-1 flex flex-col gap-4">
        <Card className="flex-1">
          <SubtitleViewer videoId={videoId} />
        </Card>
        <Card className="flex-1">
          <TranslationPanel />
        </Card>
      </div>
    </div>
  );
}
