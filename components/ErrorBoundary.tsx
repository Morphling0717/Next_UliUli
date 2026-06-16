"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import type { SiteConfig } from '@/app/admin/types';

type WindowWithSiteConfig = Window & typeof globalThis & {
  SITE_CONFIG?: SiteConfig;
};

interface ErrorBoundaryProps {
  children: ReactNode;
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
    const errorCfg =
      typeof window !== "undefined" ? (window as WindowWithSiteConfig).SITE_CONFIG?.errors || {} : {};
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/90 backdrop-blur p-10 text-white">
          <div className="max-w-2xl w-full bg-red-900/30 border border-red-500/50 rounded-xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-red-400 mb-4 flex items-center gap-2">
              {errorCfg.title || "⚠ 页面遇到了一点小故障 (Page Crashed)"}
            </h2>
            <p className="mb-4 text-gray-300">
              {errorCfg.message || "请不用担心，这是一个程序错误，不是你的问题。"}
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
              {errorCfg.retryText || "刷新页面重试"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}
