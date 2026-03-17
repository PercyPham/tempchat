import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { hotelActions } from "../context/HotelContext";
import { Spinner } from "../components/shared/Spinner";

function InputField({
  id, label, value, onChange, placeholder, maxLength,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder: string; maxLength: number;
}) {
  return (
    <div className="group">
      <label htmlFor={id} className="block text-xs font-medium text-warm-white/40 uppercase tracking-[0.1em] mb-2">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full rounded-2xl px-4 py-3.5 text-warm-white placeholder-warm-white/20 text-sm bg-transparent focus:outline-none transition-all"
        style={{
          background: "rgba(28,35,51,0.6)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
        }}
        onFocus={(e) => {
          e.currentTarget.style.border = "1px solid rgba(245,158,11,0.4)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.08), 0 1px 0 rgba(255,255,255,0.03) inset";
        }}
        onBlur={(e) => {
          e.currentTarget.style.border = "1px solid rgba(255,255,255,0.07)";
          e.currentTarget.style.boxShadow = "0 1px 0 rgba(255,255,255,0.03) inset";
        }}
      />
    </div>
  );
}

export function CreateRoomPage() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!roomName.trim() || !displayName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { result } = await hotelActions.createRoom({
        name: roomName.trim(),
        creatorName: displayName.trim(),
      });
      navigate(`/invite/${result.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-5 pt-10 pb-24 animate-fade-in">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 text-warm-white/30 hover:text-warm-white/70 mb-10 transition-colors text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-extrabold text-warm-white leading-tight mb-2">
          New room
        </h1>
        <p className="text-warm-white/35 text-sm">
          Room name and your identity are AES-encrypted before leaving your device.
        </p>
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-5">
        <InputField id="roomName" label="Room name" value={roomName} onChange={setRoomName} placeholder="Project Alpha" maxLength={60} />
        <InputField id="displayName" label="Your name" value={displayName} onChange={setDisplayName} placeholder="Alice" maxLength={32} />

        {error && (
          <p className="text-crimson text-sm bg-crimson/8 rounded-xl px-4 py-2.5 border border-crimson/15">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !roomName.trim() || !displayName.trim()}
          className="relative mt-2 flex items-center justify-center gap-2 rounded-2xl py-4 text-obsidian font-display font-bold text-base transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            boxShadow: loading || !roomName.trim() || !displayName.trim()
              ? "none"
              : "0 0 20px rgba(245,158,11,0.3), 0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {loading ? <Spinner size={20} /> : "Create room →"}
        </button>
      </form>

      {/* Encryption note */}
      <div className="mt-8 flex items-start gap-3 p-4 rounded-2xl"
        style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-amber/60 flex-shrink-0 mt-0.5">
          <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-warm-white/35 text-xs leading-relaxed">
          The server stores only ciphertext. Even we cannot read your messages or room name.
        </p>
      </div>
    </div>
  );
}
