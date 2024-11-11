import { join } from 'path';
import { writeFile, readFile, unlink, readdir } from 'fs/promises';
import { TranscriptionResult } from './types';

const CACHE_DIR = join(process.cwd(), 'cache');
const MAX_CACHE_SIZE = 1024 * 1024 * 1024; // 1GB
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheMetadata {
  size: number;
  timestamp: number;
  videoId: string;
  language?: string;
}

export class VideoCache {
  private static instance: VideoCache;
  private metadata: Map<string, CacheMetadata>;

  private constructor() {
    this.metadata = new Map();
    this.initializeCache().catch(console.error);
  }

  static getInstance(): VideoCache {
    if (!VideoCache.instance) {
      VideoCache.instance = new VideoCache();
    }
    return VideoCache.instance;
  }

  private async initializeCache() {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      const files = await readdir(CACHE_DIR);
      
      for (const file of files) {
        if (file.endsWith('.metadata')) {
          const metadataPath = join(CACHE_DIR, file);
          try {
            const data = await readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(data) as CacheMetadata;
            this.metadata.set(metadata.videoId, metadata);
          } catch (error) {
            console.error(`Error reading cache metadata for ${file}:`, error);
            await unlink(metadataPath).catch(console.error);
          }
        }
      }

      await this.cleanCache();
    } catch (error) {
      console.error('Error initializing cache:', error);
    }
  }

  private async cleanCache() {
    const now = Date.now();
    const entries = Array.from(this.metadata.entries());
    
    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    let currentSize = entries.reduce((sum, [_, meta]) => sum + meta.size, 0);
    
    for (const [videoId, metadata] of entries) {
      // Remove if too old or if we need to free up space
      if (now - metadata.timestamp > MAX_CACHE_AGE || currentSize > MAX_CACHE_SIZE) {
        await this.invalidateCache(videoId);
        currentSize -= metadata.size;
      }
    }
  }

  async getCached(videoId: string): Promise<TranscriptionResult[] | null> {
    const metadata = this.metadata.get(videoId);
    if (!metadata) return null;

    try {
      const cachePath = join(CACHE_DIR, `${videoId}.json`);
      const data = await readFile(cachePath, 'utf-8');
      
      // Update timestamp
      metadata.timestamp = Date.now();
      await this.saveMetadata(videoId, metadata);
      
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading cache for ${videoId}:`, error);
      await this.invalidateCache(videoId);
      return null;
    }
  }

  async setCached(videoId: string, data: TranscriptionResult[]): Promise<void> {
    const jsonData = JSON.stringify(data);
    const cachePath = join(CACHE_DIR, `${videoId}.json`);
    
    try {
      await writeFile(cachePath, jsonData);
      
      const metadata: CacheMetadata = {
        size: jsonData.length,
        timestamp: Date.now(),
        videoId,
        language: data[0]?.language
      };
      
      await this.saveMetadata(videoId, metadata);
      this.metadata.set(videoId, metadata);
      
      await this.cleanCache();
    } catch (error) {
      console.error(`Error writing cache for ${videoId}:`, error);
    }
  }

  private async saveMetadata(videoId: string, metadata: CacheMetadata): Promise<void> {
    const metadataPath = join(CACHE_DIR, `${videoId}.metadata`);
    await writeFile(metadataPath, JSON.stringify(metadata));
  }

  async invalidateCache(videoId: string): Promise<void> {
    try {
      const cachePath = join(CACHE_DIR, `${videoId}.json`);
      const metadataPath = join(CACHE_DIR, `${videoId}.metadata`);
      
      await Promise.all([
        unlink(cachePath).catch(() => {}),
        unlink(metadataPath).catch(() => {})
      ]);
      
      this.metadata.delete(videoId);
    } catch (error) {
      console.error(`Error invalidating cache for ${videoId}:`, error);
    }
  }

  getCacheStats(): { totalSize: number; entries: number } {
    let totalSize = 0;
    for (const metadata of this.metadata.values()) {
      totalSize += metadata.size;
    }
    return {
      totalSize,
      entries: this.metadata.size
    };
  }
}