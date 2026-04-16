"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// 确保在客户端注册 GSAP 插件
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// 1. 背景光效与背景图控制
export const ThreeBackground: React.FC = () => {
  const bgImageRef = useRef<HTMLImageElement>(null);
  const bgWrapperRef = useRef<HTMLDivElement>(null);

  // === 动画 1：背景图片鼠标视差 (Parallax) 效果 ===
  useEffect(() => {
    if (bgImageRef.current) {
      gsap.set(bgImageRef.current, { scale: 1.1 });
    }

    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;

      if (bgImageRef.current) {
        gsap.to(bgImageRef.current, {
          x: x * -30, 
          y: y * -30, 
          duration: 1.5, 
          ease: "power2.out"
        });
      }
    };

    if (window.matchMedia("(hover: hover)").matches) {
      window.addEventListener('mousemove', handleMouseMove);
    }
    
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // === 动画 2：页面向下滚动时，背景图慢慢浮现的效果 ===
  useEffect(() => {
    if (bgWrapperRef.current) {
      gsap.fromTo(bgWrapperRef.current,
        { opacity: 0 }, 
        {
          opacity: 1, 
          ease: "none",
          scrollTrigger: {
            trigger: document.body,
            start: "top top",
            end: "100vh top", 
            scrub: 1, 
          }
        }
      );
    }
  }, []);

  // === 动画 3：3D 粒子系统 ===
  useEffect(() => {
    const canvas = document.getElementById("canvas-bg") as HTMLCanvasElement;
    let frameId: number;
    let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera;
    let particles: THREE.Points;
    let geometry: THREE.BufferGeometry, material: THREE.PointsMaterial;

    if (canvas) {
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x050508, 0.002);

      camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      );
      camera.position.z = 50;

      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // 粒子构建
      const particleCount = 300;
      geometry = new THREE.BufferGeometry();
      const positions: number[] = [], colors: number[] = [], sizes: number[] = [], speeds: number[] = [];
      const color1 = new THREE.Color(0x2de2e6);
      const color2 = new THREE.Color(0x035aa6);
      const color3 = new THREE.Color(0xffffff);

      for (let i = 0; i < particleCount; i++) {
        positions.push(
          (Math.random() - 0.5) * 200,
          (Math.random() - 0.5) * 200,
          (Math.random() - 0.5) * 100
        );
        const rand = Math.random();
        const targetColor = rand > 0.6 ? color1 : rand > 0.3 ? color2 : color3;
        colors.push(targetColor.r, targetColor.g, targetColor.b);
        sizes.push(Math.random() * 2 + 0.5);
        speeds.push(Math.random() * 0.05 + 0.01);
      }

      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
      geometry.setAttribute("speed", new THREE.Float32BufferAttribute(speeds, 1));

      const createParticleTexture = () => {
        const texCanvas = document.createElement("canvas");
        texCanvas.width = 32;
        texCanvas.height = 32;
        const ctx = texCanvas.getContext("2d");
        if (ctx) {
          const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
          gradient.addColorStop(0, "rgba(255,255,255,1)");
          gradient.addColorStop(0.2, "rgba(255,255,255,0.8)");
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 32, 32);
        }
        return new THREE.CanvasTexture(texCanvas);
      };

      material = new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        map: createParticleTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      particles = new THREE.Points(geometry, material);
      scene.add(particles);

      gsap.to(particles.scale, {
        x: 1.5,
        y: 1.5,
        z: 1.5,
        ease: "none",
        scrollTrigger: {
          trigger: "body",
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      });

      const animate = () => {
        frameId = requestAnimationFrame(animate);

        // 使用 TS 断言确保 array 类型
        const posArray = particles.geometry.attributes.position.array as Float32Array;
        const speedArray = particles.geometry.attributes.speed.array as Float32Array;

        for (let i = 0; i < particleCount; i++) {
          const yIndex = i * 3 + 1;
          posArray[yIndex] += speedArray[i];
          if (posArray[yIndex] > 100) {
            posArray[yIndex] = -100;
          }
        }
        particles.geometry.attributes.position.needsUpdate = true;
        particles.rotation.y += 0.001;

        renderer.render(scene, camera);
      };

      animate();

      const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(frameId);
        if (geometry) geometry.dispose();
        if (material) material.dispose();
        if (renderer) renderer.dispose();
      };
    }
  }, []);

  return (
    <div className="fixed inset-0 w-full h-full -z-10 bg-(--dark-bg, #050508) overflow-hidden">
      <div ref={bgWrapperRef} className="absolute inset-0 w-full h-full opacity-0 pointer-events-none">
        <img
          ref={bgImageRef}
          src="/Background.webp"
          className="absolute inset-0 w-full h-full object-cover"
          alt="Background"
        />
        <div className="absolute inset-0 bg-black/60"></div>
      </div>
      
      {/* 这里的 canvas 必须挂载，供 Three.js 抓取 */}
      {/* 由于我们在 layout.tsx 中已经放置了一个 id 为 canvas-bg 的挂载点，若重复会导致问题。*/}
      {/* 如果 layout.tsx 里保留了 <canvas id="canvas-bg">，这里的可以不加。我帮你统一了 ID。 */}
    </div>
  );
};

// 2. 自定义鼠标光标 (仅桌面端)
export const CustomCursor: React.FC = () => {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;

    const cursor = document.createElement("div");
    cursor.id = "custom-cursor";
    Object.assign(cursor.style, {
      position: "fixed",
      width: "20px",
      height: "20px",
      border: "2px solid var(--neon-blue)",
      borderRadius: "50%",
      pointerEvents: "none",
      zIndex: "9999",
      transform: "translate(-50%, -50%)",
      transition: "width 0.3s, height 0.3s, background-color 0.3s",
    });
    document.body.appendChild(cursor);

    const moveCursor = (e: MouseEvent) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";

      if (Math.random() > 0.8) {
        const trail = document.createElement("div");
        trail.className = "cursor-trail";
        Object.assign(trail.style, {
          position: "fixed",
          width: "8px",
          height: "8px",
          backgroundColor: "var(--neon-blue)",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: "9998",
          opacity: "0.6",
          left: e.clientX + "px",
          top: e.clientY + "px",
        });
        document.body.appendChild(trail);
        gsap.to(trail, {
          scale: 0,
          opacity: 0,
          duration: 0.8,
          onComplete: () => trail.remove(),
        });
      }
    };

    const hoverStart = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.closest("a, button, .interactive")) {
        cursor.style.width = "50px";
        cursor.style.height = "50px";
        cursor.style.backgroundColor = "rgba(45, 226, 230, 0.2)";
        cursor.style.borderColor = "transparent";
      }
    };
    
    const hoverEnd = () => {
      cursor.style.width = "20px";
      cursor.style.height = "20px";
      cursor.style.backgroundColor = "transparent";
      cursor.style.borderColor = "var(--neon-blue)";
    };

    window.addEventListener("mousemove", moveCursor);
    document.body.addEventListener("mouseover", hoverStart);
    document.body.addEventListener("mouseout", hoverEnd);
    
    return () => {
      window.removeEventListener("mousemove", moveCursor);
      document.body.removeEventListener("mouseover", hoverStart);
      document.body.removeEventListener("mouseout", hoverEnd);
      const cursorEl = document.getElementById("custom-cursor");
      if (cursorEl) cursorEl.remove();
      document.querySelectorAll(".cursor-trail").forEach(el => el.remove());
    };
  }, []);

  return null;
};