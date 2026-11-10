import { useEffect } from 'react';
import { motion } from './motion';

// Popups open over the home screen and lobby, which scroll on their own. While any popup is open, html gets
// `modal-open` and styles.css stops those screens from scrolling, so wheel or swipe gestures over the backdrop (or
// past the end of a popup's own content) don't move the page behind it. Counted, since popups can stack.
let open = 0;
function useScrollLock() {
  useEffect(() => {
    if (open++ === 0) document.documentElement.classList.add('modal-open');
    return () => {
      if (--open === 0) document.documentElement.classList.remove('modal-open');
    };
  }, []);
}

export function Modal({ children, onClose, className = '' }: { children: React.ReactNode; onClose?: () => void; className?: string }) {
  useScrollLock();
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={`panel modal ${className}`}
        initial={{ y: 40, scale: 0.92, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
