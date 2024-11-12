import { EventEmitter } from 'events';
import { progressTracker } from './progress';

interface QueueItem {
  videoId: string;
  userId: string;
  priority: number;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  state: 'pending' | 'processing' | 'failed' | 'completed';
  error?: string;
}

export class ProcessingQueue extends EventEmitter {
  private static instance: ProcessingQueue;
  private queue: QueueItem[] = [];
  private processing: Set<string> = new Set();
  private readonly MAX_CONCURRENT = 3;
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly MAX_RETRIES = 3;
  private readonly CLEANUP_INTERVAL = 3600000; // 1 hour
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.startQueueProcessor();
    this.startCleanupTimer();
  }

  static getInstance(): ProcessingQueue {
    if (!ProcessingQueue.instance) {
      ProcessingQueue.instance = new ProcessingQueue();
    }
    return ProcessingQueue.instance;
  }

  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleItems();
    }, this.CLEANUP_INTERVAL);
  }

  private cleanupStaleItems() {
    const now = Date.now();
    const TWO_HOURS = 7200000;

    // Remove completed items older than 2 hours
    this.queue = this.queue.filter(item => {
      const isStale = item.state === 'completed' && (now - item.timestamp > TWO_HOURS);
      if (isStale) {
        console.log(`Cleaning up stale item: ${item.videoId}`);
        this.emit('cleaned', item);
      }
      return !isStale;
    });
  }

  async enqueue(videoId: string, userId: string, priority: number = 1): Promise<void> {
    // Check if video is already in queue or processing
    if (this.isQueued(videoId) || this.isProcessing(videoId)) {
      throw new Error('Video is already being processed');
    }

    // Check queue size limit
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error('Queue is full. Please try again later.');
    }

    const queueItem: QueueItem = {
      videoId,
      userId,
      priority,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: this.MAX_RETRIES,
      state: 'pending'
    };

    this.queue.push(queueItem);
    this.sortQueue();

    // Update progress for queued item
    progressTracker.updateProgress(
      videoId,
      'initialization',
      0,
      'Queued for processing',
      `Position in queue: ${this.getQueuePosition(videoId)}`
    );

    this.emit('enqueued', queueItem);
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // Sort by state first (pending before others)
      if (a.state === 'pending' && b.state !== 'pending') return -1;
      if (a.state !== 'pending' && b.state === 'pending') return 1;

      // Then by priority (higher priority first)
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      // Then by timestamp (older first)
      return a.timestamp - b.timestamp;
    });

    // Update queue positions for all pending items
    this.queue
      .filter(item => item.state === 'pending')
      .forEach((item, index) => {
        progressTracker.updateProgress(
          item.videoId,
          'initialization',
          0,
          'Waiting in queue',
          `Position in queue: ${index + 1}`
        );
      });
  }

  private startQueueProcessor(): void {
    setInterval(() => {
      this.processNextItems();
    }, 1000); // Check queue every second
  }

  private async processNextItems(): Promise<void> {
    const pendingItems = this.queue.filter(item => item.state === 'pending');
    
    while (this.processing.size < this.MAX_CONCURRENT && pendingItems.length > 0) {
      const item = pendingItems.shift();
      if (item) {
        item.state = 'processing';
        this.processing.add(item.videoId);
        
        this.processItem(item).catch((error) => {
          console.error(`Error processing video ${item.videoId}:`, error);
          item.error = error.message;
          
          if (item.retryCount < item.maxRetries) {
            item.retryCount++;
            item.state = 'pending';
            progressTracker.updateProgress(
              item.videoId,
              'initialization',
              0,
              `Retrying (${item.retryCount}/${item.maxRetries})`,
              'Waiting for retry'
            );
          } else {
            item.state = 'failed';
            progressTracker.reportError(
              item.videoId, 
              `Failed to process video after ${item.maxRetries} attempts: ${item.error}`
            );
          }
        }).finally(() => {
          this.processing.delete(item.videoId);
          this.sortQueue();
        });
      }
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    // Emit processing event
    this.emit('processing', item);

    // Update progress
    progressTracker.updateProgress(
      item.videoId,
      'initialization',
      0,
      'Starting processing',
      'Initializing video processing'
    );

    // The actual processing will be handled by the routes
    // This just manages the queue
  }

  isQueued(videoId: string): boolean {
    return this.queue.some(item => 
      item.videoId === videoId && 
      (item.state === 'pending' || item.state === 'processing')
    );
  }

  isProcessing(videoId: string): boolean {
    return this.processing.has(videoId);
  }

  getQueuePosition(videoId: string): number {
    const index = this.queue.findIndex(item => 
      item.videoId === videoId && 
      item.state === 'pending'
    );
    return index === -1 ? -1 : index + 1;
  }

  getQueueStatus(): { 
    queueLength: number; 
    processing: number;
    failed: number;
    completed: number;
    pendingItems: Array<{ videoId: string; position: number }>;
  } {
    const pendingItems = this.queue
      .filter(item => item.state === 'pending')
      .map((item, index) => ({
        videoId: item.videoId,
        position: index + 1
      }));

    return {
      queueLength: this.queue.filter(item => item.state === 'pending').length,
      processing: this.processing.size,
      failed: this.queue.filter(item => item.state === 'failed').length,
      completed: this.queue.filter(item => item.state === 'completed').length,
      pendingItems
    };
  }

  removeFromQueue(videoId: string): boolean {
    const index = this.queue.findIndex(item => 
      item.videoId === videoId && 
      item.state === 'pending'
    );
    
    if (index !== -1) {
      this.queue.splice(index, 1);
      progressTracker.clearProgress(videoId);
      this.emit('removed', videoId);
      return true;
    }
    return false;
  }

  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

export const processingQueue = ProcessingQueue.getInstance();
