import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; text: ReactNode; undo?: () => void };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Glass pill, bottom-centre, 5 s, optional Undo in accent (SCREENS: design extension). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="fixed left-1/2 -translate-x-1/2 bottom-6 max-[639px]:bottom-[92px] z-50 flex flex-col items-center gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto flex items-center gap-4 rounded-[14px] px-4 py-3 text-[14px] bg-[rgba(20,22,30,0.85)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)]"
            >
              <span>{t.text}</span>
              {t.undo && (
                <button
                  type="button"
                  onClick={() => {
                    t.undo!();
                    dismiss(t.id);
                  }}
                  className="text-accent font-medium bg-transparent border-0 cursor-pointer min-h-11 px-1 -my-3"
                >
                  Undo
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
