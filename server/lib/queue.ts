import { EventEmitter } from 'events';
import { progressTracker } from './progress';

interface QueueItem {
  videoId: string;
  userId: string;
  priority: number;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

export class ProcessingQueue extends EventEmitter {
  private static instance: ProcessingQueue;
  private queue: QueueItem[] = [];
  private processing: Set<string> = new Set();
  private readonly MAX_CONCURRENT = 3;
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly MAX_RETRIES = 3;

  private constructor() {
    super();
    this.processQueue();
  }

  static getInstance(): ProcessingQueue {
    if (!ProcessingQueue.instance) {
      ProcessingQueue.instance = new ProcessingQueue();
    }
    return ProcessingQueue.instance;
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
      // Sort by priority first (higher priority first)
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // Then by timestamp (older first)
      return a.timestamp - b.timestamp;
    });
  }

  private async processQueue(): Promise<void> {
    setInterval(() => {
      while (this.processing.size < this.MAX_CONCURRENT && this.queue.length > 0) {
        const item = this.queue.shift();
        if (item) {
          this.processing.add(item.videoId);
          this.processItem(item).catch((error) => {
            console.error(`Error processing video ${item.videoId}:`, error);
            if (item.retryCount < item.maxRetries) {
              item.retryCount++;
              this.queue.unshift(item);
              progressTracker.updateProgress(
                item.videoId,
                'initialization',
                0,
                `Retrying (${item.retryCount}/${item.maxRetries})`,
                'Waiting for retry'
              );
            } else {
              progressTracker.reportError(item.videoId, 'Failed to process video after multiple attempts');
            }
          }).finally(() => {
            this.processing.delete(item.videoId);
          });
        }
      }
    }, 1000); // Check queue every second
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
    return this.queue.some(item => item.videoId === videoId);
  }

  isProcessing(videoId: string): boolean {
    return this.processing.has(videoId);
  }

  getQueuePosition(videoId: string): number {
    const index = this.queue.findIndex(item => item.videoId === videoId);
    return index === -1 ? -1 : index + 1;
  }

  getQueueStatus(): { queueLength: number; processing: number } {
    return {
      queueLength: this.queue.length,
      processing: this.processing.size
    };
  }

  removeFromQueue(videoId: string): boolean {
    const index = this.queue.findIndex(item => item.videoId === videoId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }
}

export const processingQueue = ProcessingQueue.getInstance();
