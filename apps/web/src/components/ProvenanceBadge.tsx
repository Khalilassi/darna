import type { Provenance } from "@/lib/api";
import type { Dict } from "@/lib/i18n";

export function ProvenanceBadge({ value, t }: { value: Provenance; t: Dict }) {
  return (
    <span className={`prov prov-${value}`} data-provenance={value}>
      {t.provenance[value]}
    </span>
  );
}
