import { QRCodeSVG } from "qrcode.react";

interface Props {
  url: string;
  size?: number;
}

export function QRDisplay({ url, size = 220 }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Amber-glowing QR frame */}
      <div className="relative p-[2px] rounded-3xl"
        style={{
          background: "linear-gradient(135deg, rgba(245,158,11,0.6) 0%, rgba(217,119,6,0.2) 50%, rgba(245,158,11,0.4) 100%)",
          boxShadow: "0 0 30px rgba(245,158,11,0.2), 0 0 60px rgba(245,158,11,0.08)",
        }}
      >
        <div className="bg-warm-white rounded-[22px] p-5">
          <QRCodeSVG
            value={url}
            size={size}
            bgColor="#F9FAFB"
            fgColor="#0D0F14"
            level="M"
          />
        </div>
      </div>

      <p className="text-warm-white/25 text-xs text-center max-w-[220px] leading-relaxed">
        Key lives in the <span className="text-amber/50 font-medium">#fragment</span> — never transmitted to any server
      </p>
    </div>
  );
}
