import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LocaleLayout, { generateMetadata } from "@/app/[locale]/layout";
import Landing from "@/app/[locale]/page";

const params = (locale: string) => Promise.resolve({ locale });

describe("locale layout", () => {
  it("renders Arabic with dir=rtl and lang=ar", async () => {
    const html = renderToStaticMarkup(await LocaleLayout({ children: <p>x</p>, params: params("ar") }));
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(html).toContain("دارنا");
    expect(html).toContain('href="/en"'); // language switch to English
  });

  it("renders English left-to-right", async () => {
    const html = renderToStaticMarkup(await LocaleLayout({ children: <p>x</p>, params: params("en") }));
    expect(html).toMatch(/<html lang="en" dir="ltr">/);
  });

  it("emits hreflang alternates for both languages", async () => {
    const meta = await generateMetadata({ params: params("ar") });
    expect(meta.alternates?.languages).toMatchObject({ en: expect.stringMatching(/\/en$/), ar: expect.stringMatching(/\/ar$/) });
    expect(meta.alternates?.canonical).toMatch(/\/ar$/);
  });
});

describe("Arabic landing page", () => {
  it("shows Arabic content, coming-soon store badges (no links) and the independence disclaimer", async () => {
    render(await Landing({ params: params("ar") }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("بيوت مباشرة من ملاك موثقين");
    expect(screen.getAllByText("قريباً")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /App Store|Google Play/ })).not.toBeInTheDocument();
    expect(screen.getByText(/الحالات سجلات وليست نقلاً قانونياً/, { selector: "strong" })).toBeInTheDocument();
  });

  it("footer disclaimer names TMG independence", async () => {
    const html = renderToStaticMarkup(await LocaleLayout({ children: null, params: params("ar") }));
    expect(html).toContain("غير تابع لمجموعة طلعت مصطفى");
    const en = renderToStaticMarkup(await LocaleLayout({ children: null, params: params("en") }));
    expect(en).toContain("not affiliated with, endorsed by, or acting on behalf of Talaat Moustafa Group");
  });
});
