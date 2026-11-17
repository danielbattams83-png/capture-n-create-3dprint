"use client";

import { motion } from "framer-motion";
import { Box, Home, ImagePlus, Images, Palette, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = {
  href: string;
  label: string;
  mobileLabel: string;
  icon: LucideIcon;
};

const navigation: NavigationItem[] = [
  { href: "/", label: "Home", mobileLabel: "Home", icon: Home },
  { href: "/assets", label: "Assets", mobileLabel: "Assets", icon: Images },
  {
    href: "/create-image",
    label: "Create Image",
    mobileLabel: "Image",
    icon: ImagePlus,
  },
  {
    href: "/create-model",
    label: "Create Model",
    mobileLabel: "Model",
    icon: Box,
  },
  { href: "/textures", label: "Textures", mobileLabel: "Textures", icon: Palette },
];

export default function Header() {
  const pathname = usePathname();

  const scrollToTop = () => {
    window.scrollTo(0, 0);
  };

  return (
    <>
      <header className="relative z-40 border-b border-white/[0.06] bg-[#0B0D12]">
        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 pb-4 sm:px-6 md:pb-5">
        <Link
          href="/"
          onClick={scrollToTop}
            className="relative block h-36 w-full max-w-2xl shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 sm:h-40 md:h-44"
          aria-label="A.C.E.S. 3D Print Studio home"
        >
          <Image
            src="/A.C.E.S. 3D Print Studio.png"
            alt="A.C.E.S. 3D Print Studio"
            width={2197}
            height={1431}
            priority
              className="size-full object-cover object-center"
          />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-[#0B0D12]" />
        </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden rounded-2xl border border-white/10 bg-slate-950/75 p-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl md:flex"
          >
            {navigation.map((item) => {
              const Icon = item.icon;
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
                  className={`relative isolate flex h-10 items-center gap-2 rounded-xl px-3.5 text-xs font-medium tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
                    active ? "text-white" : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="desktop-navigation-active"
                      className="absolute inset-0 -z-10 rounded-xl border border-blue-400/20 bg-blue-500/15"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <nav
          aria-label="Primary navigation"
          className="pointer-events-auto mx-auto grid max-w-[430px] grid-cols-5 rounded-[1.4rem] border border-white/10 bg-slate-950/75 p-1.5 shadow-[0_-1px_0_rgba(255,255,255,0.05),0_18px_50px_rgba(0,0,0,0.58)] backdrop-blur-xl"
        >
          {navigation.map((item) => {
            const Icon = item.icon;
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
                className={`relative isolate flex min-w-0 flex-col items-center justify-center gap-1 rounded-[1rem] px-0.5 py-2 text-[10px] font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 ${
                  active ? "text-white" : "text-slate-400 active:text-slate-100"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-navigation-active"
                    className="absolute inset-0 -z-10 rounded-[1rem] border border-blue-400/20 bg-blue-500/15"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
                <span className="max-w-full truncate">{item.mobileLabel}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
