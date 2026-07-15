import {
  getShaderColorFromString,
  getShaderNoiseTexture,
  HalftoneCmykTypes,
  halftoneCmykFragmentShader,
  ShaderFitOptions,
  ShaderMount,
} from "@paper-design/shaders";

const BREAKPOINT = "(min-width: 1001px)";
const TRANSITION_INTERVAL = 10000;
const MAX_PIXEL_COUNT = 1920 * 1080;
const HALFTONE_FRAGMENT_SHADER = halftoneCmykFragmentShader.replace(
  "radius = max(0., radius);",
  "radius = max(u_minDot, radius);",
);
const mediaQuery = window.matchMedia(BREAKPOINT);
const frame = document.querySelector(".homepage-slideshow");
const imageData = document.querySelector("#homepage-slideshow-images");

if (frame && imageData) {
  const layers = Array.from(
    frame.querySelectorAll(".homepage-slideshow__layer"),
  );
  const fallbackImages = layers.map((layer) =>
    layer.querySelector(".homepage-slideshow__fallback"),
  );

  let imageUrls;

  try {
    const parsed = JSON.parse(imageData.textContent);

    if (!Array.isArray(parsed) || parsed.some((url) => typeof url !== "string")) {
      throw new TypeError("图片数据必须是只包含字符串的 JSON 数组");
    }

    imageUrls = parsed.map((url) => url.trim()).filter(Boolean);
  } catch (error) {
    console.error("Homepage slideshow: 图片 JSON 无效，轮播未启动。", error);
  }

  if (
    imageUrls &&
    imageUrls.length > 0 &&
    layers.length === 2 &&
    fallbackImages.every(Boolean)
  ) {
    const failedUrls = new Set();
    const pendingImages = new Map();
    let mounts = [];
    let activeLayer = 0;
    let currentIndex = -1;
    let nextSlidePromise = null;
    let timerId = null;
    let lifecycle = 0;
    let mode = null;
    let initializing = false;
    let noiseTexturePromise = null;

    const baseUniforms = {
      u_colorBack: getShaderColorFromString("#f2f1e8"),
      u_colorC: getShaderColorFromString("#7a7a75"),
      u_colorM: getShaderColorFromString("#7a7a75"),
      u_colorY: getShaderColorFromString("#7a7a75"),
      u_colorK: getShaderColorFromString("#231f20"),
      u_size: 0.01,
      u_gridNoise: 0.6,
      u_type: HalftoneCmykTypes.dots,
      u_softness: 0.2,
      u_contrast: 2,
      u_minDot: 0,
      u_floodC: 0,
      u_floodM: 0,
      u_floodY: 0,
      u_floodK: 0.1,
      u_gainC: -0.17,
      u_gainM: -0.45,
      u_gainY: -0.45,
      u_gainK: 0,
      u_grainMixer: 0.19,
      u_grainOverlay: 0,
      u_grainSize: 0.04,
      u_fit: ShaderFitOptions.cover,
      u_scale: 1.24,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: 0.5,
      u_originY: 0.5,
    };

    function isCurrent(token) {
      return token === lifecycle && mediaQuery.matches;
    }

    function stopTimer() {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    }

    function abortPendingImages() {
      pendingImages.forEach((resolve, image) => {
        image.onload = null;
        image.onerror = null;
        image.src = "";
        resolve(null);
      });
      pendingImages.clear();
    }

    function disposeMounts() {
      mounts.forEach((mount) => mount.dispose());
      mounts = [];
      layers.forEach((layer) => {
        layer.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
      });
    }

    function resetLayers() {
      layers.forEach((layer) => layer.classList.remove("is-visible"));
      fallbackImages.forEach((image) => image.removeAttribute("src"));
      frame.classList.remove("is-fallback");
    }

    function teardown() {
      lifecycle += 1;
      initializing = false;
      stopTimer();
      abortPendingImages();
      disposeMounts();
      resetLayers();
      activeLayer = 0;
      currentIndex = -1;
      nextSlidePromise = null;
      mode = null;
    }

    function loadImage(url, token) {
      return new Promise((resolve) => {
        const image = new Image();
        pendingImages.set(image, resolve);
        image.crossOrigin = "anonymous";

        function finish(result) {
          image.onload = null;
          image.onerror = null;
          pendingImages.delete(image);
          resolve(result);
        }

        image.onload = () => {
          if (
            isCurrent(token) &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0
          ) {
            finish(image);
          } else {
            finish(null);
          }
        };

        image.onerror = () => {
          if (isCurrent(token)) {
            failedUrls.add(url);
            console.error(`Homepage slideshow: 图片加载失败，已跳过 ${url}`);
          }
          finish(null);
        };

        image.src = url;
      });
    }

    async function findSlide(startIndex, excludedIndex, token) {
      for (let checked = 0; checked < imageUrls.length; checked += 1) {
        if (!isCurrent(token)) return null;

        const index = (startIndex + checked) % imageUrls.length;
        const url = imageUrls[index];

        if (index === excludedIndex || failedUrls.has(url)) continue;

        const image = await loadImage(url, token);
        if (image) return { image, index, url };
      }

      return null;
    }

    function loadNoiseTexture() {
      if (noiseTexturePromise) return noiseTexturePromise;

      noiseTexturePromise = new Promise((resolve, reject) => {
        const image = getShaderNoiseTexture();

        if (!image) {
          reject(new Error("Paper Shaders: 无法创建噪声纹理"));
          return;
        }

        if (image.complete && image.naturalWidth > 0) {
          resolve(image);
          return;
        }

        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Paper Shaders: 噪声纹理加载失败"));
      });

      return noiseTexturePromise;
    }

    function runShaderOperation(operation) {
      const originalConsoleError = console.error;
      let reportedError = null;

      console.error = (...args) => {
        originalConsoleError.apply(console, args);
        reportedError ||= new Error(args.map(String).join(" "));
      };

      try {
        const result = operation();
        return { error: reportedError, result };
      } finally {
        console.error = originalConsoleError;
      }
    }

    function makeMount(layer, image, noiseTexture) {
      const operation = runShaderOperation(
        () =>
          new ShaderMount(
            layer,
            HALFTONE_FRAGMENT_SHADER,
            { ...baseUniforms, u_image: image, u_noiseTexture: noiseTexture },
            { alpha: false },
            0,
            0,
            1,
            MAX_PIXEL_COUNT,
            ["u_image"],
          ),
      );
      const mount = operation.result;

      if (
        operation.error ||
        !mount.program ||
        mount.canvasElement.getContext("webgl2")?.isContextLost()
      ) {
        mount.dispose();
        throw (
          operation.error ||
          new Error("Paper Shaders: Shader 编译或 WebGL2 初始化失败")
        );
      }

      return mount;
    }

    function nextFrame() {
      return new Promise((resolve) => window.requestAnimationFrame(resolve));
    }

    async function verifyCanvases(token) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (!isCurrent(token) || document.hidden) return false;

        const ready = mounts.every((mount) => {
          const pixelCount = mount.canvasElement.width * mount.canvasElement.height;
          return pixelCount > 0 && pixelCount <= MAX_PIXEL_COUNT;
        });

        if (ready) return true;
        await nextFrame();
      }

      return false;
    }

    function enableFallback(error) {
      disposeMounts();
      mode = "fallback";
      frame.classList.add("is-fallback");
      console.error(
        "Homepage slideshow: Shader 失败，已切换为原始图片轮播。这不代表 Shader 验收通过。",
        error,
      );
    }

    function setLayerSlide(layerIndex, slide) {
      fallbackImages[layerIndex].src = slide.url;

      if (mode === "shader") {
        const mount = mounts[layerIndex];
        const operation = runShaderOperation(() =>
          mount.setUniforms({ u_image: slide.image }),
        );
        if (operation.error) throw operation.error;

        const context = mount.canvasElement.getContext("webgl2");
        if (!mount.program || !context || context.isContextLost()) {
          throw new Error("Paper Shaders: 更新图片纹理失败");
        }
      }
    }

    function prepareNext(token) {
      nextSlidePromise = findSlide(currentIndex + 1, currentIndex, token);
    }

    function scheduleNext(token) {
      stopTimer();
      if (!isCurrent(token) || document.hidden) return;

      timerId = window.setTimeout(() => {
        timerId = null;
        showNext(token);
      }, TRANSITION_INTERVAL);
    }

    async function showNext(token) {
      const slide = await nextSlidePromise;
      if (!slide || !isCurrent(token) || document.hidden) return;

      const nextLayer = activeLayer === 0 ? 1 : 0;

      try {
        setLayerSlide(nextLayer, slide);
      } catch (error) {
        enableFallback(error);
        fallbackImages[nextLayer].src = slide.url;
      }

      await nextFrame();
      if (!isCurrent(token) || document.hidden) return;

      layers[nextLayer].classList.add("is-visible");
      layers[activeLayer].classList.remove("is-visible");
      activeLayer = nextLayer;
      currentIndex = slide.index;
      prepareNext(token);
      scheduleNext(token);
    }

    async function initialize() {
      if (initializing || mode || !mediaQuery.matches || document.hidden) return;

      initializing = true;
      const token = lifecycle;
      let firstSlide;
      let noiseTexture;

      try {
        [firstSlide, noiseTexture] = await Promise.all([
          findSlide(0, -1, token),
          loadNoiseTexture(),
        ]);
      } catch (error) {
        initializing = false;
        console.error("Homepage slideshow: Shader 资源加载失败。", error);
        return;
      }

      if (!firstSlide || !isCurrent(token) || document.hidden) {
        initializing = false;
        if (isCurrent(token) && !document.hidden) {
          console.error("Homepage slideshow: 所有图片均加载失败，轮播已停止。");
        }
        return;
      }

      fallbackImages.forEach((image) => {
        image.src = firstSlide.url;
      });

      try {
        mounts = [];
        layers.forEach((layer) => {
          mounts.push(makeMount(layer, firstSlide.image, noiseTexture));
        });
        mode = "shader";

        const canvasesReady = await verifyCanvases(token);
        if (!isCurrent(token) || document.hidden) {
          teardown();
          return;
        }

        if (!canvasesReady) {
          throw new Error("Paper Shaders: Canvas 未在规定时间内完成首次渲染");
        }
      } catch (error) {
        enableFallback(error);
      }

      if (!isCurrent(token)) {
        initializing = false;
        return;
      }
      if (document.hidden) {
        teardown();
        return;
      }

      currentIndex = firstSlide.index;
      activeLayer = 0;
      await nextFrame();

      if (!isCurrent(token)) {
        initializing = false;
        return;
      }
      if (document.hidden) {
        teardown();
        return;
      }

      layers[activeLayer].classList.add("is-visible");
      prepareNext(token);
      scheduleNext(token);
      initializing = false;
    }

    function handleMediaChange(event) {
      if (event.matches) {
        initialize();
      } else {
        teardown();
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopTimer();
      } else if (mediaQuery.matches) {
        if (mode) {
          scheduleNext(lifecycle);
        } else {
          initialize();
        }
      }
    }

    mediaQuery.addEventListener("change", handleMediaChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    initialize();
  }
}
