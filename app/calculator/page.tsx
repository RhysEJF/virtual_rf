'use client';

import { useState } from 'react';
import { CalculatorDisplay } from './components/CalculatorDisplay';

export default function CalculatorPage(): JSX.Element {
  const [display, setDisplay] = useState<string>('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState<boolean>(false);

  const inputDigit = (digit: string): void => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const inputDecimal = (): void => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const clear = (): void => {
    setDisplay('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  const performOperation = (nextOperator: string): void => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operator) {
      const currentValue = previousValue;
      let result: number;

      switch (operator) {
        case '+':
          result = currentValue + inputValue;
          break;
        case '-':
          result = currentValue - inputValue;
          break;
        case '×':
          result = currentValue * inputValue;
          break;
        case '÷':
          result = inputValue !== 0 ? currentValue / inputValue : 0;
          break;
        default:
          result = inputValue;
      }

      setDisplay(String(result));
      setPreviousValue(result);
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  };

  const calculate = (): void => {
    if (operator === null || previousValue === null) return;

    const inputValue = parseFloat(display);
    let result: number;

    switch (operator) {
      case '+':
        result = previousValue + inputValue;
        break;
      case '-':
        result = previousValue - inputValue;
        break;
      case '×':
        result = previousValue * inputValue;
        break;
      case '÷':
        result = inputValue !== 0 ? previousValue / inputValue : 0;
        break;
      default:
        result = inputValue;
    }

    setDisplay(String(result));
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(true);
  };

  const toggleSign = (): void => {
    const value = parseFloat(display);
    setDisplay(String(value * -1));
  };

  const percentage = (): void => {
    const value = parseFloat(display);
    setDisplay(String(value / 100));
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-bg-primary">
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-lg bg-bg-secondary border border-border">
        {/* Display */}
        <CalculatorDisplay
          value={display}
          previousValue={previousValue}
          operator={operator}
        />

        {/* Button Grid */}
        <div className="grid grid-cols-4 gap-3">
          {/* Row 1: AC, +/-, %, ÷ */}
          <CalcButton onClick={clear} variant="function">AC</CalcButton>
          <CalcButton onClick={toggleSign} variant="function">+/-</CalcButton>
          <CalcButton onClick={percentage} variant="function">%</CalcButton>
          <CalcButton onClick={() => performOperation('÷')} variant="operator" active={operator === '÷'}>÷</CalcButton>

          {/* Row 2: 7, 8, 9, × */}
          <CalcButton onClick={() => inputDigit('7')}>7</CalcButton>
          <CalcButton onClick={() => inputDigit('8')}>8</CalcButton>
          <CalcButton onClick={() => inputDigit('9')}>9</CalcButton>
          <CalcButton onClick={() => performOperation('×')} variant="operator" active={operator === '×'}>×</CalcButton>

          {/* Row 3: 4, 5, 6, - */}
          <CalcButton onClick={() => inputDigit('4')}>4</CalcButton>
          <CalcButton onClick={() => inputDigit('5')}>5</CalcButton>
          <CalcButton onClick={() => inputDigit('6')}>6</CalcButton>
          <CalcButton onClick={() => performOperation('-')} variant="operator" active={operator === '-'}>-</CalcButton>

          {/* Row 4: 1, 2, 3, + */}
          <CalcButton onClick={() => inputDigit('1')}>1</CalcButton>
          <CalcButton onClick={() => inputDigit('2')}>2</CalcButton>
          <CalcButton onClick={() => inputDigit('3')}>3</CalcButton>
          <CalcButton onClick={() => performOperation('+')} variant="operator" active={operator === '+'}>+</CalcButton>

          {/* Row 5: 0 (wide), ., = */}
          <CalcButton onClick={() => inputDigit('0')} wide>0</CalcButton>
          <CalcButton onClick={inputDecimal}>.</CalcButton>
          <CalcButton onClick={calculate} variant="equals">=</CalcButton>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <span className="text-xs font-medium tracking-widest uppercase text-text-tertiary">
            Calculator
          </span>
        </div>
      </div>
    </main>
  );
}

interface CalcButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'number' | 'operator' | 'function' | 'equals';
  wide?: boolean;
  active?: boolean;
}

function CalcButton({
  children,
  onClick,
  variant = 'number',
  wide = false,
  active = false,
}: CalcButtonProps): JSX.Element {
  const getClassName = (): string => {
    const base = 'h-14 rounded-lg font-medium text-xl transition-all duration-150 active:scale-95 border';

    switch (variant) {
      case 'operator':
        return `${base} ${
          active
            ? 'bg-accent text-white border-accent-hover shadow-md'
            : 'bg-accent-light text-accent border-border hover:bg-accent-muted hover:text-white'
        }`;
      case 'function':
        return `${base} bg-bg-tertiary text-text-secondary border-border hover:bg-border hover:text-text-primary`;
      case 'equals':
        return `${base} bg-accent text-white border-accent-hover hover:bg-accent-hover shadow-sm`;
      default:
        return `${base} bg-bg-primary text-text-primary border-border hover:bg-bg-tertiary`;
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${getClassName()} ${wide ? 'col-span-2' : ''}`}
    >
      {children}
    </button>
  );
}
