import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const subtitles = pgTable("subtitles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  videoId: text("video_id").notNull(),
  start: integer("start").notNull(),
  end: integer("end").notNull(),
  text: text("text").notNull(),
  language: text("language"),
  createdAt: timestamp("created_at").defaultNow()
});

export const insertSubtitleSchema = createInsertSchema(subtitles);
export const selectSubtitleSchema = createSelectSchema(subtitles);
export type InsertSubtitle = z.infer<typeof insertSubtitleSchema>;
export type Subtitle = z.infer<typeof selectSubtitleSchema>;
