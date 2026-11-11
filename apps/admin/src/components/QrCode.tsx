"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders `value` as a QR code image (generated locally; the secret never leaves the browser). */
export function QrCode({ value, label, size = 184 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div className="muted small">Generating QR code…</div>;
  // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize
  return <img src={src} width={size} height={size} alt={label} className="qr" />;
}
