import type { Dict } from "@/lib/i18n";

/** App store badges. The app is not published yet, so these are not links. */
export function StoreButtons({ t }: { t: Dict }) {
  const stores = [
    { name: t.app.appStore, platform: "iOS" },
    { name: t.app.googlePlay, platform: "Android" },
  ];
  return (
    <ul className="stores" aria-label={t.app.title}>
      {stores.map((s) => (
        <li key={s.name}>
          <span className="store" aria-disabled="true">
            <span className="store-text">
              <span className="store-platform">{s.platform}</span>
              <span className="store-name">{s.name}</span>
              <span className="store-soon">{t.app.comingSoon}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
