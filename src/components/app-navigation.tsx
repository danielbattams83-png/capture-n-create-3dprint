"use client";

import { motion } from "framer-motion";
import {
  Box,
  Home,
  ImagePlus,
  Images,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

type NavigationItem = {
  id: string;
  label: string;
  mobileLabel: string;
  href: string;
  icon: LucideIcon;
};

const navigationItems: NavigationItem[] = [
  { id: "home", label: "Home", mobileLabel: "Home", href: "#top", icon: Home },
  { id: "assets", label: "Assets", mobileLabel: "Assets", href: "#assets", icon: Images },
  {
    id: "image",
    label: "Create Image",
    mobileLabel: "Image",
    href: "#capture",
    icon: ImagePlus,
  },
  {
    id: "model",
    label: "Create Model",
    mobileLabel: "Model",
    href: "#model",
    icon: Box,
  },
  {
    id: "textures",
    label: "Textures",
    mobileLabel: "Textures",
    href: "#textures",
    icon: Palette,
  },
];

export default function AppNavigation() {
  const [activeItem, setActiveItem] = useState("home");

  return (
    <>
      <nav
        aria-label="Primary navigation"
        className="mx-auto hidden w-fit rounded-2xl border border-white/10 bg-slate-950/75 p-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl md:flex"
      >
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;

          return (
            <a
              key={item.id}
              href={item.href}
              onClick={() => setActiveItem(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative isolate flex h-10 items-center gap-2 rounded-xl px-3.5 text-xs font-medium tracking-wide transition-colors ${
                isActive ? "text-white" : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="desktop-navigation-active"
                  className="absolute inset-0 -z-10 rounded-xl border border-blue-400/20 bg-blue-500/15"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <nav
          aria-label="Primary navigation"
          className="pointer-events-auto mx-auto grid max-w-[430px] grid-cols-5 rounded-[1.4rem] border border-white/10 bg-slate-950/75 p-1.5 shadow-[0_-1px_0_rgba(255,255,255,0.05),0_18px_50px_rgba(0,0,0,0.58)] backdrop-blur-xl"
        >
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <a
                key={item.id}
                href={item.href}
                onClick={() => setActiveItem(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`relative isolate flex min-w-0 flex-col items-center justify-center gap-1 rounded-[1rem] px-0.5 py-2 text-[10px] font-medium leading-none transition-colors ${
                  isActive ? "text-white" : "text-slate-400 active:text-slate-100"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="mobile-navigation-active"
                    className="absolute inset-0 -z-10 rounded-[1rem] border border-blue-400/20 bg-blue-500/15"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
                <span className="max-w-full truncate">{item.mobileLabel}</span>
              </a>
            );
          })}
        </nav>
      </div>
    </>
  );
}
