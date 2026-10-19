import { useCallback, useLayoutEffect, useRef } from 'react';

export default function FitText({ text, className = '', minSize = 8, maxSize = 1000 }) {
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
    const observer = box && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (observer && box) observer.observe(box);

    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    let cancelled = false;
    if (fonts) {
      fonts.ready.then(() => { if (!cancelled) fit(); }).catch(() => {});
      if (fonts.addEventListener) fonts.addEventListener('loadingdone', fit);
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (fonts && fonts.removeEventListener) fonts.removeEventListener('loadingdone', fit);
    };
  }, [fit, text]);

  return (
    <div ref={boxRef} className={`lc-fit ${className}`}>
      <span ref={spanRef} className="lc-fit-text">{text}</span>
    </div>
  );
}
