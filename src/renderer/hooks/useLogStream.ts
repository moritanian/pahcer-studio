import { useEffect } from 'react';
import { TestExecution, LogMessage } from '../../schemas/execution';

interface UseLogStreamProps {
  onStatusChange?: (data: {
    executionId: string;
    status: string;
    execution: TestExecution;
  }) => void;
  onProgress?: (data: TestExecution) => void;
  onLog?: (data: { executionId: string; log: LogMessage }) => void;
  onCompleted?: (data: { executionId: string; status: string; execution: TestExecution }) => void;
}

export const useLogStream = ({
  onStatusChange,
  onProgress,
  onLog,
  onCompleted,
}: UseLogStreamProps) => {
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = () => {
      // Default handler if needed
    };

    eventSource.addEventListener('execution:status', (event) => {
      if (onStatusChange) {
        const data = JSON.parse(event.data);
        onStatusChange(data);
      }
    });

    eventSource.addEventListener('execution:progress', (event) => {
      if (onProgress) {
        const data = JSON.parse(event.data);
        onProgress(data);
      }
    });

    eventSource.addEventListener('execution:log', (event) => {
      if (onLog) {
        const data = JSON.parse(event.data);
        onLog(data);
      }
    });

    eventSource.addEventListener('execution:completed', (event) => {
      if (onCompleted) {
        const data = JSON.parse(event.data);
        onCompleted(data);
      }
    });

    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      // Reconnection is handled automatically by EventSource usually,
      // but we might want to show some UI indication if it fails persistently.
    };

    return () => {
      eventSource.close();
    };
  }, [onStatusChange, onProgress, onLog, onCompleted]);
};
