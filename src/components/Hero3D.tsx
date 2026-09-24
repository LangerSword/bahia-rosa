import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from "three";
import { gradeFor, gradePixels } from "../look/timeofday";
import { SCENES, sceneSrc, type SceneId } from "../look/scenes";

/**
 * The city, in three dimensions.
 *
 * The plate is not a background image here — it is a floor and a sky at different depths, with the
 * camera drifting between them. Two things follow from that: the foreground moves more than the
 * distance when you move the pointer (which is the whole point of doing it in 3D rather than with a CSS
 * transform), and the hour of the day can be graded onto the same texture the scene is drawn with, so
 * "neon" and "night" change the place you are standing in rather than tinting a photo.
 *
 * Cost is bounded on purpose: one texture, three objects, no post-processing, device pixel ratio capped
 * at 1.5, and the loop stops when the canvas leaves the viewport. Under `prefers-reduced-motion` it
 * renders a single still frame. If WebGL is unavailable or fails, it renders the plain plate instead —
 * the page must read correctly without any of this.
 */

interface Hero3DProps {
  scene: SceneId;
  look: string;
  className?: string;
  /** Rendered when WebGL is unavailable or throws. */
  width?: number;
  height?: number;
}

/** Cover the viewport with a plane at z=0 for a camera looking straight down -Z. */
function coverScale(camera: PerspectiveCamera, distance: number, aspect: number): { width: number; height: number } {
  const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
  return { height, width: height * aspect };
}

export function Hero3D({ scene, look, className }: Hero3DProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (typeof WebGLRenderer === "undefined") {
      setFailed(true);
      return;
    }

    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }

    const boxWidth = node.clientWidth || 1120;
    const boxHeight = node.clientHeight || 460;
    // The drawing buffer is capped independently of the CSS box: a background does not need 1440 real
    // pixels, and under software WebGL (a headless browser, a machine without a GPU) the fill rate is
    // the whole cost of the scene. The canvas is stretched to fit by CSS.
    const width = Math.min(boxWidth, 1280);
    const height = Math.max(240, Math.round((boxHeight / boxWidth) * width));
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true");
    node.appendChild(renderer.domElement);

    const scene3d = new Scene();
    const camera = new PerspectiveCamera(52, width / height, 0.1, 100);
    camera.position.set(0, 0, 0);

    const group = new Group();
    scene3d.add(group);

    let disposed = false;
    let texture: Texture | null = null;

    /** Grade the plate to the chosen hour, through a canvas, then hand it to three as a texture. */
    const loadGradedTexture = async (): Promise<Texture | null> => {
      const image = new Image();
      image.decoding = "async";
      image.src = sceneSrc(scene);
      try {
        await image.decode();
      } catch {
        return null;
      }
      if (disposed) return null;
      const canvas = document.createElement("canvas");
      // Half the source is plenty for a background at this size and keeps the upload cheap.
      canvas.width = Math.min(1400, image.width);
      canvas.height = Math.round((canvas.width / image.width) * image.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      data.data.set(gradePixels(data.data, gradeFor(look)));
      ctx.putImageData(data, 0, 0);
      // Straight from the canvas. TextureLoader loads asynchronously — its `image` is null for a beat,
      // and reading `plate.image.width` in that beat is a crash, not a slow load.
      const loaded = new Texture(canvas);
      loaded.colorSpace = SRGBColorSpace;
      loaded.needsUpdate = true;
      return loaded;
    };

    const build = (plate: Texture): void => {
      const aspect = width / height;
      const cover = coverScale(camera, 6, aspect);
      const imageAspect = (plate.image as { width: number; height: number }).width /
        (plate.image as { width: number; height: number }).height;

      // Back plane: the plate, covering the viewport, pushed away.
      const backGeometry = new PlaneGeometry(cover.width, cover.height);
      const backMaterial = new MeshBasicMaterial({ map: plate });
      const back = new Mesh(backGeometry, backMaterial);
      back.position.z = -6;
      // Fit the plate inside the cover rect without distortion: scale the geometry to the image aspect.
      const fit = Math.max(cover.width / imageAspect / cover.height, 1);
      back.scale.set(fit, 1, 1);
      group.add(back);

      // Foreground: the bottom of the same plate, nearer the camera, so it slides more than the sky.
      const stripGeometry = new PlaneGeometry(cover.width * 1.15, cover.height * 0.42);
      const stripMaterial = new MeshBasicMaterial({ map: plate, transparent: true, opacity: 0.92 });
      stripMaterial.map = plate.clone();
      stripMaterial.map.needsUpdate = true;
      // Show only the lower band of the texture in this layer.
      stripMaterial.map.repeat.set(1, 0.42);
      stripMaterial.map.offset.set(0, 0);
      const strip = new Mesh(stripGeometry, stripMaterial);
      strip.position.set(0, -cover.height * 0.32, -2.6);
      group.add(strip);
    };

    void loadGradedTexture().then((plate) => {
      if (disposed) return;
      if (!plate) {
        setFailed(true);
        return;
      }
      texture = plate;
      build(plate);
      render();
    });

    // Motes: a little atmosphere at three depths, deterministic so two loads look the same.
    const motes = 140;
    const positions = new Float32Array(motes * 3);
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < motes; i += 1) {
      positions[i * 3] = (rand() - 0.5) * 14;
      positions[i * 3 + 1] = (rand() - 0.3) * 8;
      positions[i * 3 + 2] = -1 - rand() * 7;
    }
    const moteGeometry = new BufferGeometry();
    moteGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const moteMaterial = new PointsMaterial({ color: 0xfff0d0, size: 0.035, transparent: true, opacity: 0.5 });
    const points = new Points(moteGeometry, moteMaterial);
    group.add(points);

    // Pointer parallax: the target moves the camera, the loop eases toward it — and the loop is on a
    // 24fps budget, because this is a background, not a game. It also *settles*: after a dozen seconds
    // with no pointer input it stops entirely and waits, which is what keeps a software renderer from
    // eating the machine while the visitor reads the page.
    const target = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent): void => {
      const box = node.getBoundingClientRect();
      target.x = ((event.clientX - box.left) / box.width - 0.5) * 0.5;
      target.y = ((event.clientY - box.top) / box.height - 0.5) * 0.3;
      start();
      settle();
    };

    const render = (): void => {
      renderer.render(scene3d, camera);
    };

    let raf = 0;
    let lastDrawn = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (now - lastDrawn < 41) return; // ~24fps
      lastDrawn = now;
      camera.position.x += (target.x - camera.position.x) * 0.045;
      camera.position.y += (-target.y - camera.position.y) * 0.045;
      camera.rotation.y = -camera.position.x * 0.06;
      camera.rotation.x = camera.position.y * 0.05;
      points.rotation.y += 0.0004;
      render();
    };

    const start = (): void => {
      if (reduce) {
        render();
        return;
      }
      if (!raf) {
        lastDrawn = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    let idle: ReturnType<typeof setTimeout> | null = null;
    const settle = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(stop, 12_000);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    if (!reduce) node.addEventListener("pointermove", onPointer);

    // Stop burning a GPU when the hero is scrolled away — this is a background, not a game.
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) start();
                else stop();
              }
            },
            { threshold: 0.02 },
          )
        : null;
    if (observer) observer.observe(node);
    else {
      start();
      settle();
    }

    const onResize = (): void => {
      const nextBoxWidth = node.clientWidth || boxWidth;
      const nextBoxHeight = node.clientHeight || boxHeight;
      const nextWidth = Math.min(nextBoxWidth, 1280);
      const nextHeight = Math.max(240, Math.round((nextBoxHeight / nextBoxWidth) * nextWidth));
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      render();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      stop();
      if (idle) clearTimeout(idle);
      observer?.disconnect();
      node.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      moteGeometry.dispose();
      moteMaterial.dispose();
      texture?.dispose();
      group.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === node) node.removeChild(renderer.domElement);
    };
  }, [scene, look]);

  if (failed) {
    return (
      <img
        src={sceneSrc(scene)}
        alt={`${SCENES[scene].label}, graded to ${look}`}
        className={className}
        aria-hidden="true"
      />
    );
  }

  return <div ref={host} className={className} data-testid="hero-3d" aria-hidden="true" />;
}