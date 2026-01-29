'use client';

interface CalculatorDisplayProps {
  value: string;
  previousValue: number | null;
  operator: string | null;
  maxDigits?: number;
}

export function CalculatorDisplay({
  value,
  previousValue,
  operator,
  maxDigits = 12,
}: CalculatorDisplayProps): JSX.Element {
  const displayValue = value.length > maxDigits
    ? value.slice(0, maxDigits) + '...'
    : value;

  return (
    <div className="mb-6 p-4 rounded-xl text-right bg-bg-tertiary border border-border">
      {/* Previous value and operator indicator */}
      {operator && previousValue !== null && (
        <div className="text-sm mb-1 truncate text-accent">
          {previousValue} {operator}
        </div>
      )}

      {/* Main display value */}
      <div className="text-4xl font-light tracking-tight overflow-hidden text-text-primary font-mono">
        {displayValue}
      </div>
    </div>
  );
}
