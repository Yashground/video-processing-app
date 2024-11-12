import { join } from 'path';
import { writeFile, readFile, unlink, readdir, mkdir, access, constants } from 'fs/promises';
import { TranscriptionResult } from './types';

const CACHE_DIR = join(process.cwd(), 'cache');
const MAX_CACHE_SIZE = 1024 * 1024 * 1024; // 1GB
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CONCURRENT_OPERATIONS = 5; // Maximum concurrent file operations

interface CacheMetadata {
  size: number;
  timestamp: number;
  videoId: string;
  language?: string;
  hits: number; // Track cache hits for LRU/LFU hybrid
}

export class VideoCache {
  private static instance: VideoCache;
  private metadata: Map<string, CacheMetadata>;
  private initialized: boolean = false;
  private operationQueue: Set<Promise<any>> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.metadata = new Map();
    this.initializeCache().catch(console.error);
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanCache(), 3600000); // Every hour
  }

  static getInstance(): VideoCache {
    if (!VideoCache.instance) {
      VideoCache.instance = new VideoCache();
    }
    return VideoCache.instance;
  }

  private async ensureDirectory() {
    try {
      await access(CACHE_DIR, constants.F_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(CACHE_DIR, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  private async initializeCache() {
    if (this.initialized) return;
    
    try {
      await this.ensureDirectory();
      const files = await readdir(CACHE_DIR);
      
      for (const file of files) {
        if (file.endsWith('.metadata')) {
          const metadataPath = join(CACHE_DIR, file);
          try {
            const data = await readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(data) as CacheMetadata;
            // Initialize hits if not present
            metadata.hits = metadata.hits || 0;
            this.metadata.set(metadata.videoId, metadata);
          } catch (error) {
            console.error(`Error reading cache metadata for ${file}:`, error);
            await unlink(metadataPath).catch(console.error);
          }
        }
      }

      await this.cleanCache();
      this.initialized = true;
    } catch (error) {
      console.error('Error initializing cache:', error);
      throw new Error(`Cache initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async queueOperation<T>(operation: () => Promise<T>): Promise<T> {
    // Clean up completed operations
    for (const promise of this.operationQueue) {
      if (promise.status === 'fulfilled' || promise.status === 'rejected') {
        this.operationQueue.delete(promise);
      }
    }
    
    // If queue is full, wait for an operation to complete
    while (this.operationQueue.size >= MAX_CONCURRENT_OPERATIONS) {
      await Promise.race([...this.operationQueue]);
      // Clean up after waiting
      for (const promise of this.operationQueue) {
        if (promise.status === 'fulfilled' || promise.status === 'rejected') {
          this.operationQueue.delete(promise);
        }
      }
    }

    const promise = operation();
    this.operationQueue.add(promise);
    try {
      return await promise;
    } finally {
      this.operationQueue.delete(promise);
    }
  }

  private async cleanCache() {
    const now = Date.now();
    const entries = [...this.metadata.entries()];
    
    // Sort by a combination of age, size, and hit count (hybrid LRU/LFU)
    entries.sort((a, b) => {
      const scoreA = (now - a[1].timestamp) * (1 / (a[1].hits + 1));
      const scoreB = (now - b[1].timestamp) * (1 / (b[1].hits + 1));
      return scoreA - scoreB;
    });
    
    let currentSize = entries.reduce((sum, [_, meta]) => sum + meta.size, 0);
    
    for (const [videoId, metadata] of entries) {
      if (now - metadata.timestamp > MAX_CACHE_AGE || currentSize > MAX_CACHE_SIZE) {
        await this.invalidateCache(videoId);
        currentSize -= metadata.size;
      }
    }
  }

  async getCached(videoId: string): Promise<TranscriptionResult[] | null> {
    return this.queueOperation(async () => {
      try {
        await this.initializeCache();
        const metadata = this.metadata.get(videoId);
        if (!metadata) return null;

        const cachePath = join(CACHE_DIR, `${videoId}.json`);
        const data = await readFile(cachePath, 'utf-8');
        
        // Update metadata
        metadata.timestamp = Date.now();
        metadata.hits++;
        await this.saveMetadata(videoId, metadata);
        
        return JSON.parse(data);
      } catch (error) {
        console.error(`Error reading cache for ${videoId}:`, error);
        await this.invalidateCache(videoId);
        return null;
      }
    });
  }

  async setCached(videoId: string, data: TranscriptionResult[]): Promise<void> {
    return this.queueOperation(async () => {
      try {
        await this.initializeCache();
        await this.ensureDirectory();

        const jsonData = JSON.stringify(data);
        const cachePath = join(CACHE_DIR, `${videoId}.json`);
        
        await writeFile(cachePath, jsonData);
        
        const metadata: CacheMetadata = {
          size: jsonData.length,
          timestamp: Date.now(),
          videoId,
          language: data[0]?.language,
          hits: 1
        };
        
        await this.saveMetadata(videoId, metadata);
        this.metadata.set(videoId, metadata);
        
        await this.cleanCache();
      } catch (error) {
        console.error(`Error writing cache for ${videoId}:`, error);
        throw new Error(`Failed to cache data: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async saveMetadata(videoId: string, metadata: CacheMetadata): Promise<void> {
    try {
      const metadataPath = join(CACHE_DIR, `${videoId}.metadata`);
      await writeFile(metadataPath, JSON.stringify(metadata));
    } catch (error) {
      console.error(`Error saving metadata for ${videoId}:`, error);
      throw new Error(`Failed to save metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async invalidateCache(videoId: string): Promise<void> {
    return this.queueOperation(async () => {
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
    });
  }

  getCacheStats(): { totalSize: number; entries: number; hitRate: number } {
    let totalSize = 0;
    let totalHits = 0;
    
    for (const metadata of this.metadata.values()) {
      totalSize += metadata.size;
      totalHits += metadata.hits;
    }

    return {
      totalSize,
      entries: this.metadata.size,
      hitRate: totalHits / Math.max(1, this.metadata.size)
    };
  }

  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    // Wait for any pending operations to complete
    await Promise.all([...this.operationQueue]);
  }
}
