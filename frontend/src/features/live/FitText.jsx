import { useCallback, useLayoutEffect, useRef } from 'react';

export default function FitText({ text, className = '', minSize = 8, maxSize = 400 }) {
  const boxRef = useRef(null);
  const spanRef = useRef(null);

  const fit = useCallback(() => {
    const box = boxRef.current;
    const span = spanRef.current;
    if (!box || !span) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    let lo = minSize;
    let hi = Math.max(minSize, maxSize);
    for (let i = 0; i < 16; i += 1) {
      const mid = (lo + hi) / 2;
      span.style.fontSize = `${mid}px`;
      const rect = span.getBoundingClientRect();
      if (rect.width <= w && rect.height <= h) lo = mid;
      else hi = mid;
    }
    span.style.fontSize = `${lo}px`;
  }, [minSize, maxSize]);

  useLayoutEffect(() => {
    fit();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit, text]);

  return (
    <div ref={boxRef} className={`lc-fit ${className}`}>
      <span ref={spanRef} className="lc-fit-text">{text}</span>
    </div>
  );
}
