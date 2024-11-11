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
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").defaultNow()
});

export const flashcards = pgTable("flashcards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  videoId: text("video_id").notNull(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  context: text("context"),
  timestamp: integer("timestamp").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastReviewed: timestamp("last_reviewed")
});

export const insertSubtitleSchema = createInsertSchema(subtitles);
export const selectSubtitleSchema = createSelectSchema(subtitles);
export const insertFlashcardSchema = createInsertSchema(flashcards);
export const selectFlashcardSchema = createSelectSchema(flashcards);

export type InsertSubtitle = z.infer<typeof insertSubtitleSchema>;
export type Subtitle = z.infer<typeof selectSubtitleSchema>;
export type InsertFlashcard = z.infer<typeof insertFlashcardSchema>;
export type Flashcard = z.infer<typeof selectFlashcardSchema>;
