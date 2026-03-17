import { BottomSheet } from "../shared/BottomSheet";
import { BoostOptionCard } from "../shared/BoostOptionCard";
import { useBoostOptions } from "../../hooks/useBoostOptions";
import { Spinner } from "../shared/Spinner";
import type { BoostOption } from "../../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (option: BoostOption) => void;
}

export function BoostSheet({ open, onClose, onSelect }: Props) {
  const { options, loading, error } = useBoostOptions();

  return (
    <BottomSheet open={open} onClose={onClose} title="Boost this room">
      <p className="text-warm-white/50 text-sm mb-5">
        Boosts stack additively on the current expiry time and raise participant limits.
      </p>

      {loading && (
        <div className="flex justify-center py-8"><Spinner /></div>
      )}

      {error && (
        <p className="text-crimson text-sm text-center py-4">Failed to load boost options</p>
      )}

      {!loading && !error && options.length === 0 && (
        <p className="text-warm-white/40 text-sm text-center py-4">No boost options available</p>
      )}

      {!loading && !error && options.length > 0 && (
        <div className="flex flex-col gap-3">
          {options.map((opt) => (
            <BoostOptionCard key={opt.id} option={opt} onSelect={onSelect} />
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
