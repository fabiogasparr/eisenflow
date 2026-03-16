

## Problem

On mobile, the chat input field is hidden behind the bottom navigation bar (`BottomNav`, 56px/`h-14`). The `AppLayout` sets `pb-14 md:pb-0` on `<main>`, but the chat page uses `h-full` which doesn't account for this padding properly -- the input area at the bottom gets cut off.

## Solution

Two changes in `src/pages/AIChatPage.tsx`:

1. **Add bottom padding to the input area** on mobile so it sits above the `BottomNav`: change the input container from `p-3` to `p-3 pb-[calc(0.75rem+3.5rem)] md:pb-3` (adding 56px for the bottom nav on mobile).

2. **Ensure the chat container uses proper height**: The parent `<main>` already has `pb-14 md:pb-0`, but the `h-full` on the chat container may not properly fill. We should ensure the container stretches correctly by using `h-[calc(100dvh-<header>)]` or simply ensuring the input section has enough bottom margin to clear the nav.

The simplest and most reliable fix: add `pb-16 md:pb-3` to the input wrapper div so the text field clears the bottom nav bar on mobile.

### File: `src/pages/AIChatPage.tsx`
- Line 274: Change `<div className="border-t border-border p-3">` to `<div className="border-t border-border p-3 pb-16 md:pb-3">`

This ensures the input field is visible and usable above the bottom navigation on mobile devices.

