'use client';

import { useState, useEffect, useCallback } from 'react';

interface CountdownTimerProps {
  initialSeconds: number;
  onComplete?: () => void;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function CountdownTimer({ initialSeconds, onComplete }: CountdownTimerProps): JSX.Element {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(initialSeconds);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  useEffect(() => {
    if (!isRunning || secondsRemaining <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isRunning, secondsRemaining, onComplete]);

  const start = useCallback((): void => {
    if (secondsRemaining > 0) {
      setIsRunning(true);
    }
  }, [secondsRemaining]);

  const pause = useCallback((): void => {
    setIsRunning(false);
  }, []);

  const reset = useCallback((): void => {
    setIsRunning(false);
    setSecondsRemaining(initialSeconds);
  }, [initialSeconds]);

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-stone-100 dark:bg-stone-800 rounded-xl shadow-md">
      <div className="text-6xl font-mono font-bold text-stone-800 dark:text-stone-100 tracking-wider">
        {formatTime(secondsRemaining)}
      </div>

      <div className="flex gap-3">
        {!isRunning ? (
          <button
            onClick={start}
            disabled={secondsRemaining === 0}
            className="px-6 py-2 bg-green-700 hover:bg-green-800 disabled:bg-stone-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            Start
          </button>
        ) : (
          <button
            onClick={pause}
            className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
          >
            Pause
          </button>
        )}

        <button
          onClick={reset}
          className="px-6 py-2 bg-stone-600 hover:bg-stone-700 text-white font-medium rounded-lg transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
