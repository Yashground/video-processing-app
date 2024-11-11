import { pgTable, text, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow()
});

export const subtitles = pgTable("subtitles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  videoId: text("video_id").notNull(),
  start: integer("start").notNull(),
  end: integer("end").notNull(),
  text: text("text").notNull(),
  language: text("language"),
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  timeSaved: real("time_saved"),
  createdAt: timestamp("created_at").defaultNow(),
  userId: integer("user_id").references(() => users.id)
});

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertSubtitleSchema = createInsertSchema(subtitles);
export const selectSubtitleSchema = createSelectSchema(subtitles);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof selectUserSchema>;
export type InsertSubtitle = z.infer<typeof insertSubtitleSchema>;
export type Subtitle = z.infer<typeof selectSubtitleSchema>;
