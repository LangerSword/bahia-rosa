/**
 * Vitest setup: the pipeline code uses the browser `ImageData` constructor.
 * The unit tests run in the `node` environment, so provide the minimal shape the
 * pure functions touch (width, height, data) when the real class is absent.
 */
class ImageDataShim {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

if (!("ImageData" in globalThis)) {
  Object.defineProperty(globalThis, "ImageData", { value: ImageDataShim, writable: true });
}
