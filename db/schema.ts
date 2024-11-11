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

export const vocabulary = pgTable("vocabulary", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  videoId: text("video_id").notNull(),
  word: text("word").notNull(),
  context: text("context").notNull(),
  translation: text("translation"),
  timestamp: integer("timestamp").notNull(),
  language: text("language"),
  createdAt: timestamp("created_at").defaultNow()
});

export const insertSubtitleSchema = createInsertSchema(subtitles);
export const selectSubtitleSchema = createSelectSchema(subtitles);
export const insertVocabularySchema = createInsertSchema(vocabulary);
export const selectVocabularySchema = createSelectSchema(vocabulary);

export type InsertSubtitle = z.infer<typeof insertSubtitleSchema>;
export type Subtitle = z.infer<typeof selectSubtitleSchema>;
export type InsertVocabulary = z.infer<typeof insertVocabularySchema>;
export type Vocabulary = z.infer<typeof selectVocabularySchema>;
