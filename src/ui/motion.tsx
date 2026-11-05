/*
 * framer-motion's `motion` components, set to animate opacity on the main thread instead of with the browser's Web
 * Animations API. With WAAPI, the moment a fade-in finished there was a frame where the element was back at its
 * starting opacity (0) before framer-motion committed the end value, so every box flashed once on load. Giving a
 * component an onUpdate handler is framer-motion's documented way to opt out of hardware-accelerated animation.
 */
import { motion as base } from 'framer-motion';
import { ComponentType, createElement, forwardRef } from 'react';

const noop = () => {};
const cache = new Map<PropertyKey, unknown>();

export const motion = new Proxy(base, {
  get(target, tag) {
    const Component = (target as unknown as Record<PropertyKey, unknown>)[tag];
    if (typeof tag !== 'string' || !Component) return Component;
    if (!cache.has(tag)) {
      const Wrapped = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
        createElement(Component as ComponentType<Record<string, unknown>>, { onUpdate: noop, ...props, ref }),
      );
      Wrapped.displayName = `motion.${tag}`;
      cache.set(tag, Wrapped);
    }
    return cache.get(tag);
  },
}) as typeof base;
