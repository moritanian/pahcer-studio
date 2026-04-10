import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { TestExecution, LogMessage } from '../../schemas/execution';

// イベントデータの型定義
export type ExecutionStatusEventData = {
  executionId: string;
  status: string;
  execution: TestExecution;
};

export type ExecutionLogEventData = {
  executionId: string;
  log: LogMessage;
};

export type ExecutionCompletedEventData = {
  executionId: string;
  status: string;
  execution: TestExecution;
};

export type ExecutionUpdateEventData = {
  executionId: string;
  execution: TestExecution;
};

// イベントタイプごとのハンドラー型マップ
type EventHandlerMap = {
  'execution:status': (data: ExecutionStatusEventData) => void;
  'execution:progress': (data: TestExecution) => void;
  'execution:log': (data: ExecutionLogEventData) => void;
  'execution:completed': (data: ExecutionCompletedEventData) => void;
  'execution:update': (data: ExecutionUpdateEventData) => void;
};

type EventType = keyof EventHandlerMap;

// イベントハンドラーの型定義
export interface EventSourceContextValue {
  addEventListener: <T extends EventType>(type: T, handler: EventHandlerMap[T]) => void;
  removeEventListener: <T extends EventType>(type: T, handler: EventHandlerMap[T]) => void;
}

const EventSourceContext = createContext<EventSourceContextValue | null>(null);

export const EventSourceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [listeners] = useState(() => ({
    'execution:status': new Set<EventHandlerMap['execution:status']>(),
    'execution:progress': new Set<EventHandlerMap['execution:progress']>(),
    'execution:log': new Set<EventHandlerMap['execution:log']>(),
    'execution:completed': new Set<EventHandlerMap['execution:completed']>(),
    'execution:update': new Set<EventHandlerMap['execution:update']>(),
  }));

  // EventSource の初期化
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onmessage = () => {
      // Default handler if needed
    };

    es.addEventListener('execution:status', (event) => {
      const data = JSON.parse(event.data);
      listeners['execution:status'].forEach((handler) => handler(data));
    });

    es.addEventListener('execution:progress', (event) => {
      const data = JSON.parse(event.data);
      listeners['execution:progress'].forEach((handler) => handler(data));
    });

    es.addEventListener('execution:log', (event) => {
      const data = JSON.parse(event.data);
      listeners['execution:log'].forEach((handler) => handler(data));
    });

    es.addEventListener('execution:completed', (event) => {
      const data = JSON.parse(event.data);
      listeners['execution:completed'].forEach((handler) => handler(data));
    });

    es.addEventListener('execution:update', (event) => {
      const data = JSON.parse(event.data);
      listeners['execution:update'].forEach((handler) => handler(data));
    });

    es.onerror = (error) => {
      console.error('EventSource failed:', error);
    };

    return () => {
      es.close();
    };
    // listeners は useState の初期化関数で作成され、再作成されないため安全
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addEventListener = useCallback(
    <T extends EventType>(type: T, handler: EventHandlerMap[T]) => {
      listeners[type].add(handler as never);
    },
    [listeners],
  );

  const removeEventListener = useCallback(
    <T extends EventType>(type: T, handler: EventHandlerMap[T]) => {
      listeners[type].delete(handler as never);
    },
    [listeners],
  );

  const value: EventSourceContextValue = {
    addEventListener,
    removeEventListener,
  };

  return <EventSourceContext.Provider value={value}>{children}</EventSourceContext.Provider>;
};

// 内部用カスタムフック
const useEventSource = () => {
  const context = useContext(EventSourceContext);
  if (!context) {
    throw new Error('useEventSource must be used within EventSourceProvider');
  }
  return context;
};

// 便利フック
interface UseExecutionEventsProps {
  onStatusChange?: EventHandlerMap['execution:status'];
  onProgress?: EventHandlerMap['execution:progress'];
  onLog?: EventHandlerMap['execution:log'];
  onCompleted?: EventHandlerMap['execution:completed'];
  onUpdate?: EventHandlerMap['execution:update'];
}

export const useExecutionEvents = ({
  onStatusChange,
  onProgress,
  onLog,
  onCompleted,
  onUpdate,
}: UseExecutionEventsProps) => {
  const { addEventListener, removeEventListener } = useEventSource();

  useEffect(() => {
    if (onStatusChange) {
      addEventListener('execution:status', onStatusChange);
      return () => removeEventListener('execution:status', onStatusChange);
    }
  }, [addEventListener, removeEventListener, onStatusChange]);

  useEffect(() => {
    if (onProgress) {
      addEventListener('execution:progress', onProgress);
      return () => removeEventListener('execution:progress', onProgress);
    }
  }, [addEventListener, removeEventListener, onProgress]);

  useEffect(() => {
    if (onLog) {
      addEventListener('execution:log', onLog);
      return () => removeEventListener('execution:log', onLog);
    }
  }, [addEventListener, removeEventListener, onLog]);

  useEffect(() => {
    if (onCompleted) {
      addEventListener('execution:completed', onCompleted);
      return () => removeEventListener('execution:completed', onCompleted);
    }
  }, [addEventListener, removeEventListener, onCompleted]);

  useEffect(() => {
    if (onUpdate) {
      addEventListener('execution:update', onUpdate);
      return () => removeEventListener('execution:update', onUpdate);
    }
  }, [addEventListener, removeEventListener, onUpdate]);
};
