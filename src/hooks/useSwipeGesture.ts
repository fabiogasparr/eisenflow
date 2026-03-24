import { useRef, useCallback, useState } from 'react';

interface SwipeGestureOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
  confirmLeft?: boolean;
}

export function useSwipeGesture({
  threshold = 80,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
  confirmLeft = false,
}: SwipeGestureOptions) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef<'horizontal' | 'vertical' | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    setPendingDelete(false);
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      locked.current = null;
      setIsSwiping(false);
    },
    [disabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      if (!locked.current) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
          locked.current = 'vertical';
          return;
        }
        if (Math.abs(dx) > 10) {
          locked.current = 'horizontal';
        }
      }

      if (locked.current !== 'horizontal') return;

      e.preventDefault();
      setIsSwiping(true);
      const capped = Math.abs(dx) > threshold
        ? Math.sign(dx) * (threshold + (Math.abs(dx) - threshold) * 0.3)
        : dx;
      setOffsetX(capped);
    },
    [disabled, threshold]
  );

  const onTouchEnd = useCallback(() => {
    if (locked.current !== 'horizontal') {
      setOffsetX(0);
      setIsSwiping(false);
      return;
    }

    if (Math.abs(offsetX) >= threshold) {
      const direction = offsetX > 0 ? 1 : -1;

      if (direction > 0) {
        // Right swipe → complete (no confirm needed)
        setOffsetX(direction * 400);
        setDismissed(true);
        setTimeout(() => {
          onSwipeRight?.();
          setOffsetX(0);
          setDismissed(false);
          setIsSwiping(false);
        }, 250);
      } else if (direction < 0) {
        if (confirmLeft && !pendingDelete) {
          // First swipe left → show confirm state
          setPendingDelete(true);
          setOffsetX(0);
          setIsSwiping(false);
          // Auto-cancel after 3 seconds
          pendingTimer.current = setTimeout(() => {
            setPendingDelete(false);
          }, 3000);
        } else {
          // Second swipe or no confirm needed → delete
          cancelPending();
          setOffsetX(direction * 400);
          setDismissed(true);
          setTimeout(() => {
            onSwipeLeft?.();
            setOffsetX(0);
            setDismissed(false);
            setIsSwiping(false);
          }, 250);
        }
      }
    } else {
      setOffsetX(0);
      setIsSwiping(false);
    }
  }, [offsetX, threshold, onSwipeLeft, onSwipeRight, confirmLeft, pendingDelete, cancelPending]);

  const confirmDelete = useCallback(() => {
    cancelPending();
    setOffsetX(-400);
    setDismissed(true);
    setTimeout(() => {
      onSwipeLeft?.();
      setOffsetX(0);
      setDismissed(false);
      setIsSwiping(false);
    }, 250);
  }, [onSwipeLeft, cancelPending]);

  const cancelDelete = useCallback(() => {
    cancelPending();
  }, [cancelPending]);

  return {
    offsetX,
    isSwiping,
    dismissed,
    pendingDelete,
    confirmDelete,
    cancelDelete,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
