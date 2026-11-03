import { useEffect, useState } from "react";
import { formatClock } from "./format";

// Ticks in its own component so a long run re-renders the clock, not the grid.
export function RunTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="run-timer" title="Time since this started">
      {formatClock(now - startedAt)}
    </span>
  );
}
