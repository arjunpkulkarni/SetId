/**
 * Performance monitoring utilities for React Native
 */
import React from 'react';

class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.isEnabled = __DEV__;
  }

  startTimer(key) {
    if (!this.isEnabled) return;
    this.metrics[key] = { startTime: Date.now() };
  }

  endTimer(key) {
    if (!this.isEnabled || !this.metrics[key]) return;
    const duration = Date.now() - this.metrics[key].startTime;
    this.metrics[key].duration = duration;
    
    console.log(`⏱️ [Performance] ${key}: ${duration}ms`);
    return duration;
  }

  markEvent(key, data = {}) {
    if (!this.isEnabled) return;
    console.log(`📊 [Performance] ${key}:`, data);
    this.metrics[key] = { timestamp: Date.now(), ...data };
  }

  getMetrics() {
    return this.metrics;
  }

  reset() {
    this.metrics = {};
  }
}

// Global instance
const performanceMonitor = new PerformanceMonitor();

// Convenience functions
export const startTimer = (key) => performanceMonitor.startTimer(key);
export const endTimer = (key) => performanceMonitor.endTimer(key);
export const markEvent = (key, data) => performanceMonitor.markEvent(key, data);
export const getMetrics = () => performanceMonitor.getMetrics();

// HOC for measuring component render time
export const withPerformanceMonitoring = (Component, componentName) => {
  return React.forwardRef((props, ref) => {
    React.useEffect(() => {
      markEvent(`${componentName}_mounted`);
      return () => markEvent(`${componentName}_unmounted`);
    }, []);

    const renderStart = React.useRef();
    renderStart.current = Date.now();

    React.useEffect(() => {
      const renderTime = Date.now() - renderStart.current;
      if (renderTime > 16) { // Only log if render took longer than one frame
        console.log(`🐌 [Performance] ${componentName} render: ${renderTime}ms`);
      }
    });

    return <Component {...props} ref={ref} />;
  });
};

export default performanceMonitor;