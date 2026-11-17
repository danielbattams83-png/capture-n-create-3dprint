"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";

export default function AppLoadingScreen() {
  const [visible, setVisible] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setVisible(false),
      reduceMotion ? 700 : 2200,
    );
    return () => window.clearTimeout(timeout);
  }, [reduceMotion]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="aces-loading-screen"
          role="status"
          aria-label="Loading A.C.E.S. 3D Print Studio"
          aria-live="polite"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.1 : 0.45, ease: "easeOut" }}
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#07090D]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(59,130,246,0.14),transparent_48%)]" />
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl px-5"
          >
            <motion.div
              animate={
                reduceMotion
                  ? undefined
                  : {
                      filter: [
                        "drop-shadow(0 0 0 rgba(59,130,246,0))",
                        "drop-shadow(0 0 22px rgba(59,130,246,0.24))",
                        "drop-shadow(0 0 0 rgba(59,130,246,0))",
                      ],
                    }
              }
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/A.C.E.S. 3D Print Studio.png"
                alt=""
                width={2197}
                height={1431}
                priority
                className="h-auto w-full object-contain"
              />
            </motion.div>

            <div className="mx-auto mt-5 h-1 w-36 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-300 to-blue-500"
                initial={{ x: "-100%" }}
                animate={{ x: reduceMotion ? "0%" : "100%" }}
                transition={{
                  duration: reduceMotion ? 0.1 : 1.1,
                  repeat: reduceMotion ? 0 : Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>
            <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Preparing your studio
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
