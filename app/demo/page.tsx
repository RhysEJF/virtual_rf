'use client';

import CountdownTimer from '../components/CountdownTimer';

export default function DemoPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-primary p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Ralph Built This
        </h1>
        <p className="text-text-secondary mb-8">
          Countdown timer component - built autonomously by Ralph Worker
        </p>

        <div className="flex justify-center">
          <CountdownTimer
            initialSeconds={60}
            onComplete={() => {
              alert('Timer complete!');
              console.log('Timer complete!');
            }}
          />
        </div>

        <div className="mt-8 p-4 bg-bg-secondary rounded-lg">
          <h2 className="text-lg font-medium text-text-primary mb-2">Features:</h2>
          <ul className="text-text-secondary space-y-1">
            <li>• 60-second countdown (MM:SS format)</li>
            <li>• Start / Pause / Reset controls</li>
            <li>• onComplete callback when timer hits zero</li>
            <li>• Dark mode support</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
