import { useRef, useCallback, useState } from 'react';

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 60,
  disabled = false,
}: PullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const pulling = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing) return;
      const el = containerRef.current;
      if (!el || el.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
    },
    [disabled, isRefreshing]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing) return;
      const el = containerRef.current;
      if (!el || el.scrollTop > 0) {
        if (pulling.current) {
          pulling.current = false;
          setIsPulling(false);
          setPullDistance(0);
        }
        return;
      }

      const dy = e.touches[0].clientY - startY.current;
      if (dy < 0) return;

      if (dy > 10) {
        pulling.current = true;
        setIsPulling(true);
        // Resistance: diminishing returns past threshold
        const distance = dy > threshold
          ? threshold + (dy - threshold) * 0.3
          : dy;
        setPullDistance(distance);
      }
    },
    [disabled, isRefreshing, threshold]
  );

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6);
      const start = Date.now();
      await onRefresh();
      const elapsed = Date.now() - start;
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));
      setIsRefreshing(false);
    }

    setPullDistance(0);
    setIsPulling(false);
  }, [pullDistance, threshold, onRefresh]);

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    isPulling,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
