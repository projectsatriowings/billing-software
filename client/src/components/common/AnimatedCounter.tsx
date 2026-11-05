import React, { useState, useEffect } from 'react';

export interface AnimatedCounterProps {
  value: number;
  duration?: number;
  formatter?: (val: number) => string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  triggerKey?: any;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 900,
  formatter,
  prefix = '',
  suffix = '',
  decimals = 0,
  className,
  triggerKey,
}) => {
  const [displayValue, setDisplayValue] = useState<number>(0);

  useEffect(() => {
    let startTime: number | null = null;
    let animationFrameId: number;
    const startValue = 0;
    const endValue = typeof value === 'number' && !isNaN(value) ? value : 0;

    if (endValue === 0) {
      setDisplayValue(0);
      return;
    }

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeProgress;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(endValue);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [value, duration, triggerKey]);

  let formatted = '';
  if (formatter) {
    formatted = formatter(displayValue);
  } else if (decimals > 0) {
    formatted = displayValue.toFixed(decimals);
  } else {
    formatted = Math.round(displayValue).toLocaleString('en-IN');
  }

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
};
