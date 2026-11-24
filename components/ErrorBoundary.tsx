"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import type { SiteConfig } from '@/app/admin/types';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-config';

type WindowWithSiteConfig = Window & typeof globalThis & {
  SITE_CONFIG?: SiteConfig;
};

interface ErrorBoundaryProps {
  children: ReactNode;
  config?: SiteConfig;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // 更新 state 以至于下一次渲染能够显示降级后的 UI
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    // 你同样可以将错误日志上报给服务器
    console.error("React Critical Error:", error, errorInfo);
  }

  render() {
    const windowErrors =
      typeof window !== "undefined" ? (window as WindowWithSiteConfig).SITE_CONFIG?.errors : undefined;
    const errorCfg = this.props.config?.errors || windowErrors || DEFAULT_SITE_CONFIG.errors;
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/90 backdrop-blur p-10 text-white">
          <div className="max-w-2xl w-full bg-red-900/30 border border-red-500/50 rounded-xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-red-400 mb-4 flex items-center gap-2">
              {errorCfg.title || DEFAULT_SITE_CONFIG.errors.title}
            </h2>
            <p className="mb-4 text-gray-300">
              {errorCfg.message || DEFAULT_SITE_CONFIG.errors.message}
            </p>
            <div className="bg-black/50 p-4 rounded text-sm font-mono text-red-200 overflow-auto max-h-64 mb-6">
              {this.state.error && this.state.error.toString()}
              <br />
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </div>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg font-bold transition-colors cursor-pointer"
            >
              {errorCfg.retryText || DEFAULT_SITE_CONFIG.errors.retryText}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}
