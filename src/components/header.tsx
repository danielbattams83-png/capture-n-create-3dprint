"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/assets", label: "Assets" },
  { href: "/create-image", label: "Create Image" },
  { href: "/create-model", label: "Create Model" },
  { href: "/textures", label: "Textures" },
] as const;

export default function Header() {
  const pathname = usePathname();

  const scrollToTop = () => {
    window.scrollTo(0, 0);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#11171d]/95 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className="border-b border-white/[0.06] px-4 py-3 sm:py-4">
        <Link
          href="/"
          onClick={scrollToTop}
          className="mx-auto flex w-fit min-w-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#60a5fa]"
          aria-label="A.C.E.S. 3D Print Studio home"
        >
          <Image
            src="/A.C.E.S. 3D Print Studio.png"
            alt="A.C.E.S. 3D Print Studio"
            width={2197}
            height={1431}
            priority
            className="h-auto w-[150px] object-contain sm:w-[184px]"
          />
        </Link>
      </div>

      <nav
        aria-label="Primary navigation"
        className="no-scrollbar mx-auto flex max-w-4xl snap-x snap-mandatory gap-2 overflow-x-auto px-4 py-2.5 sm:justify-center sm:px-6"
      >
        {navigation.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={scrollToTop}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 shrink-0 snap-center items-center justify-center rounded-xl border px-4 text-sm font-semibold transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa] ${
                active
                  ? "border-[#60a5fa]/50 bg-[#1d2d48] text-[#bfdbfe] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_22px_-14px_rgba(59,130,246,0.9)]"
                  : "border-white/[0.07] bg-[#182028] text-[#aeb8c4] hover:border-white/[0.14] hover:bg-[#1e242b] hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
