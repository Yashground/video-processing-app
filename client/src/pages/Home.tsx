import { useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import VideoPlayer from "../components/VideoPlayer";
import SubtitleViewer from "../components/SubtitleViewer";
import TranslationPanel from "../components/TranslationPanel";
import { useToast } from "@/hooks/use-toast";

const urlSchema = z.object({
  videoUrl: z.string().url().refine((url) => url.includes("youtube.com") || url.includes("youtu.be"))
});

export default function Home() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema)
  });

  const onSubmit = (data: z.infer<typeof urlSchema>) => {
    try {
      const url = new URL(data.videoUrl);
      let id = url.searchParams.get("v");
      if (!id && url.hostname === "youtu.be") {
        id = url.pathname.slice(1);
      }
      if (id) {
        setVideoId(id);
      } else {
        toast({
          title: "Invalid URL",
          description: "Please enter a valid YouTube video URL",
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
    <div className="container mx-auto p-4 h-screen flex flex-col gap-4">
      <Card className="p-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
            <FormField
              control={form.control}
              name="videoUrl"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input placeholder="Enter YouTube URL" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Load Video</Button>
          </form>
        </Form>
      </Card>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={50} minSize={30}>
          <VideoPlayer videoId={videoId} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={60}>
              <SubtitleViewer videoId={videoId} />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={40}>
              <TranslationPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
