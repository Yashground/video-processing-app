import { Response } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const handleError = (error: Error | AppError, res: Response) => {
  if (error instanceof AppError && error.isOperational) {
    return res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      code: error.statusCode
    });
  }

  console.error('Unexpected error:', error);
  return res.status(500).json({
    status: 'error',
    message: 'An unexpected error occurred',
    code: 500
  });
};

export const withErrorHandler = (fn: Function) => async (...args: any[]) => {
  try {
    return await fn(...args);
  } catch (error) {
    const [, res] = args;
    handleError(error as Error, res);
  }
};

export const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
  backoffFactor = 2
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) break;
      
      console.log(`Retry attempt ${attempt}/${maxRetries} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(backoffFactor, attempt - 1)));
    }
  }
  
  throw lastError || new Error('Operation failed after maximum retries');
};
