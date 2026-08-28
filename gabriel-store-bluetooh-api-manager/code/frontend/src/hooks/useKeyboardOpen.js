import { useEffect, useRef, useState } from "react";

// Browsers have no direct "on-screen keyboard visible" API. The standard
// proxy is watching visualViewport shrink — but on Android Chrome, the
// interactive-widget=resizes-content viewport meta tag (used elsewhere in
// this app so the Agent chat sizes correctly with the keyboard open) makes
// window.innerHeight shrink right along with visualViewport.height, so
// comparing the two doesn't reveal anything. Instead, track the tallest
// visualViewport.height seen since mount (or since the last width change,
// i.e. a rotation/resize) and treat a big drop from that running max as
// "keyboard opened".
export function useKeyboardOpen(threshold = 150) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const maxHeightRef = useRef(0);
  const lastWidthRef = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      if (vv.width !== lastWidthRef.current) {
        lastWidthRef.current = vv.width;
        maxHeightRef.current = vv.height;
      } else {
        maxHeightRef.current = Math.max(maxHeightRef.current, vv.height);
      }
      setKeyboardOpen(maxHeightRef.current - vv.height > threshold);
    }

    lastWidthRef.current = vv.width;
    maxHeightRef.current = vv.height;
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [threshold]);

  return keyboardOpen;
}
