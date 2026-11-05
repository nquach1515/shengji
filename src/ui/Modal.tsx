import { motion } from './motion';

export function Modal({ children, onClose, className = '' }: { children: React.ReactNode; onClose?: () => void; className?: string }) {
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
