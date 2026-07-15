# 首页 Halftone CMYK Shader 实施计划

## 1. 目标

在现有首页右侧图片轮播中，将普通图片显示替换为 Paper Shaders 的 Halftone CMYK WebGL 效果，同时保留以下既定行为：

- 只影响首页。
- 图片框固定从窗口左侧 `379px` 开始，延伸至窗口最右端并填满可见高度。
- 窗口宽度 `<=1000px` 时完全隐藏轮播；`>=1001px` 时显示。
- 图片按 URL 列表顺序循环。
- 每 10 秒开始一次切换，新旧画面交叉渐变 3 秒。
- 图片使用 `cover` 填满区域，允许裁切，不留白、不拉伸。
- 单张图片加载失败时跳过；所有图片失败时保持白色背景。
- 原网站目录和 `master` 不改动，只在 `codex/homepage-slideshow` worktree 中实施。

## 2. 已确认的当前状态

- 网站是静态 HTML/CSS/JavaScript，没有 React，也没有现有构建流程。
- 当前轮播代码位于 `index.html`，使用两个重叠的 `<img>` 图层完成交叉渐变。
- 当前测试图片为：

  1. `https://bitmobcc.oss-cn-shenzhen.aliyuncs.com/maf/uPic/2025-12-30_133452.jpg`
  2. `https://bitmobcc.oss-cn-shenzhen.aliyuncs.com/maf/uPic/2025-12-30_133602.jpg`
  3. `https://bitmobcc.oss-cn-shenzhen.aliyuncs.com/maf/uPic/2025-12-30_133556.jpg`

- 2026-07-16 已现场验证 OSS CORS：

  - `https://mafmadmaf.com` 可读取。
  - `https://www.mafmadmaf.com` 可读取。
  - `http://127.0.0.1:*` 可读取。
  - `http://localhost:*` 可读取。
  - 返回匹配来源的 `Access-Control-Allow-Origin`。
  - 返回 `Vary: Origin`。
  - 只允许 `GET, HEAD`。
  - `Access-Control-Max-Age` 为 `86400`。

因此，OSS 图片已经满足上传至 WebGL 纹理的前置条件。

## 3. 技术选择

### 3.1 使用 Vanilla JS，不引入 React

不直接使用用户提供的 `@paper-design/shaders-react` 组件。改用官方的 Vanilla JS 包：

```text
@paper-design/shaders@0.0.77
```

理由：当前网站不是 React 项目。为了一个 Canvas 效果引入 React 和 ReactDOM 会扩大运行体积和维护范围，而 Paper 官方已经提供无额外运行依赖的 Vanilla JS 版本。

依赖必须固定为精确版本，因为 Paper Shaders 的 `0.0.x` 更新可能包含不兼容改动。

### 3.2 使用本地打包文件，不依赖运行时 CDN

固定使用：

```text
esbuild@0.28.1
```

构建后的浏览器脚本保存在网站目录内。线上页面不从 npm、esm.sh、unpkg 或其他第三方 CDN 动态加载代码。

### 3.3 静态 Shader

Halftone CMYK 本身不需要时间动画。`ShaderMount` 的速度设为 `0`，只有以下情况重新绘制：

- 首张图片完成加载。
- 切换到下一张图片。
- 图片框尺寸变化。

不运行持续的逐帧动画循环。

## 4. 文件范围

实施时只允许修改或新增以下文件：

```text
index.html
package.json
package-lock.json
src/homepage-slideshow-shader.js
assets/homepage-slideshow-shader.js
PAPER_SHADER_IMPLEMENTATION_PLAN.md
```

其中：

- `src/homepage-slideshow-shader.js` 是可维护源码。
- `assets/homepage-slideshow-shader.js` 是浏览器实际加载的打包结果。
- `package.json` 只用于锁定依赖和提供构建命令。
- 不修改 `style.css`，避免影响其他页面。
- 不修改任何作品页、重定向文件或线上部署配置。
- 不提交 `node_modules/`。

## 5. 构建配置

`package.json` 使用精确版本，并提供以下命令：

```json
{
  "private": true,
  "scripts": {
    "build:shader": "esbuild src/homepage-slideshow-shader.js --bundle --format=iife --target=es2020 --minify --legal-comments=inline --outfile=assets/homepage-slideshow-shader.js"
  },
  "dependencies": {
    "@paper-design/shaders": "0.0.77"
  },
  "devDependencies": {
    "esbuild": "0.28.1"
  }
}
```

安装和构建命令固定为：

```text
npm install
npm run build:shader
```

干净环境验证使用：

```text
npm ci
npm run build:shader
```

## 6. 首页数据接口

图片 URL 列表继续保留在 `index.html` 中，避免用户每次更换图片都需要重新打包 JavaScript。

使用一个明确的 JSON 数据块：

```html
<script id="homepage-slideshow-images" type="application/json">
[
  "IMAGE_URL_1",
  "IMAGE_URL_2",
  "IMAGE_URL_3"
]
</script>
```

规则：

- 用户只需要编辑该数组。
- 空字符串跳过。
- 重复 URL 允许存在，并按列表位置播放。
- JSON 格式错误必须在控制台明确报错，轮播不启动，不猜测或修复错误内容。
- Shader 配置不放入此数据块，防止用户换图时误改渲染参数。

## 7. Shader 参数

使用用户给定的参数，不自行调整视觉结果：

```text
colorBack   #f2f1e8
colorC      #7a7a75
colorM      #7a7a75
colorY      #7a7a75
colorK      #231f20
size        0.01
gridNoise   0.6
type        dots
softness    0.2
contrast    2
floodC      0
floodM      0
floodY      0
floodK      0.1
gainC       -0.17
gainM       -0.45
gainY       -0.45
gainK       0
grainMixer  0.19
grainOverlay 0
grainSize   0.04
scale       1.24
fit         cover
```

响应式图片框不使用固定的 `width=1280` 和 `height=720`。Shader Canvas 始终匹配其父图层的实际尺寸。

Vanilla Shader uniforms 明确设置为：

```text
u_image       已完整加载的 HTMLImageElement
u_colorBack   由 #f2f1e8 转换为 0..1 RGBA
u_colorC/M/Y  由 #7a7a75 转换为 0..1 RGBA
u_colorK      由 #231f20 转换为 0..1 RGBA
u_size        0.01
u_gridNoise   0.6
u_type        HalftoneCmykTypes.dots
u_softness    0.2
u_contrast    2
u_minDot      0
u_flood*      按上述参数
u_gain*       按上述参数
u_grain*      按上述参数
u_fit         ShaderFitOptions.cover
u_scale       1.24
u_rotation    0
u_offsetX/Y   0
u_originX/Y   0.5
```

## 8. HTML 和图层结构

图片框仍是一个固定定位容器，但内部改为两个完全重叠的轮播图层：

```text
.homepage-slideshow
  .homepage-slideshow__layer A
    canvas（ShaderMount 自动创建）
    img（原图备用显示）
  .homepage-slideshow__layer B
    canvas（ShaderMount 自动创建）
    img（原图备用显示）
```

行为：

- 两个图层通过 CSS `opacity` 交叉渐变。
- 每个图层只持有一个 Canvas 和一个原始 `<img>`。
- Shader 正常时显示 Canvas，隐藏同层原图。
- WebGL2 确实不可用时，明确切换为原始图片轮播，并在控制台输出错误原因。
- CORS、纹理上传或 Shader 编译错误在验收中视为失败；原图只用于避免页面变成空白，不把降级结果当作 Shader 成功。
- 图片框保持 `pointer-events: none`，不遮挡页面链接。
- 文字主体和页脚继续位于图片框上层。

## 9. 图片加载和轮播流程

### 9.1 宽度控制

使用：

```text
window.matchMedia('(min-width: 1001px)')
```

- 不匹配时：不创建 WebGL context、不加载轮播图片、不启动计时器。
- 从宽屏缩至 `<=1000px`：清除计时器，调用两个 `ShaderMount.dispose()`，释放 Canvas、纹理和监听器。
- 从窄屏放大至 `>=1001px`：从当前列表第一张重新初始化。

### 9.2 图片预加载

每张图片必须按以下顺序加载：

```text
new Image()
设置 crossOrigin = 'anonymous'
绑定 load / error
最后设置 src
```

只有 `complete=true` 且 `naturalWidth>0` 的图片才能交给 ShaderMount。

### 9.3 首张图片

- 从 URL 列表第一项开始查找首张可用图片。
- 成功后创建两个 ShaderMount。
- 首张 Shader 图像从白色背景淡入，时间 3 秒。
- 同时开始预载下一张可用图片。

### 9.4 后续切换

- 每次切换开始时间相隔 10 秒。
- 将下一张已加载图片写入非活动图层的 `u_image`。
- 确认非活动 Canvas 已渲染后开始透明度变化。
- 两层交叉渐变 3 秒。
- 渐变完成后交换活动层身份。
- 立即开始预载下一张。
- 播放到列表末尾后回到第一项。

### 9.5 图片失败

- 单张失败：在当前循环中标记为不可用并继续下一项。
- 已失败 URL 在本次页面会话中不重复请求。
- 只剩一张可用图片：持续显示，不做无意义的自身交叉渐变。
- 所有图片失败：停止轮播，释放 ShaderMount，图片框保持 `#fff`。

## 10. 性能限制

两个 ShaderMount 均使用：

```text
speed = 0
frame = 0
minPixelRatio = 1
maxPixelCount = 2073600
mipmaps = ['u_image']
```

其中 `2073600 = 1920 * 1080`。

验收时必须确认：

- 任一 Canvas 的实际像素数不超过 `2073600`。
- 静止显示期间没有持续的 Shader requestAnimationFrame 循环。
- 同时存在的 WebGL context 固定为两个，不随轮播次数增长。
- 切换 20 次后 Canvas、图片层、计时器数量不增长。
- 页面切换到后台时不产生额外 Shader 绘制。

## 11. 明确失败原则

以下情况不能宣称实施完成：

- 页面看起来像半调效果，但实际只是 CSS 滤镜或静态叠图。
- Shader 加载失败后只显示原图，却没有报告错误。
- OSS CORS 响应缺失或来源不匹配。
- 为绕过 CORS 引入临时代理。
- 运行时依赖未锁定的 CDN URL。
- 窗口 `<=1000px` 时仍创建 WebGL context 或下载轮播图片。
- Canvas 数量随轮播持续增加。
- 修改了 `master`、其他页面或共享 `style.css`。

## 12. 实施步骤

1. 在 `codex/homepage-slideshow` worktree 中重新确认 Git 状态，保留现有未提交的首页轮播改动。
2. 创建精确版本的 `package.json` 并生成 `package-lock.json`。
3. 安装 `@paper-design/shaders@0.0.77` 和 `esbuild@0.28.1`。
4. 新建 `src/homepage-slideshow-shader.js`。
5. 将现有图片 URL 数组改为 `index.html` 内的 JSON 数据块。
6. 将现有两个 `<img>` 调整为两个 Shader 图层结构。
7. 实现宽度监听、CORS 图片预载、两个 ShaderMount、纹理切换、计时器和释放逻辑。
8. 保留原始图片作为 WebGL2 不可用时的明确备用显示。
9. 构建 `assets/homepage-slideshow-shader.js`。
10. 从 `index.html` 移除旧的内联轮播逻辑，改为加载本地 bundle；不能让新旧轮播同时运行。
11. 执行静态检查、真实浏览器验收、错误注入测试和性能检查。
12. 最终确认改动范围，不提交、不推送、不合并、不部署，等待用户预览决定。

## 13. 验收标准

### 13.1 Git 和文件范围

- 原网站目录仍在干净的 `master`。
- 实验 worktree 位于 `codex/homepage-slideshow`。
- `git diff --check` 通过。
- 变化只包含第 4 节列出的文件。
- `node_modules/` 未被 Git 跟踪。

### 13.2 构建

- 删除本地依赖后执行 `npm ci` 成功。
- `npm run build:shader` 成功且无 warning/error。
- 输出文件是本地 bundle，不含运行时 CDN import。
- 连续构建两次结果一致。

### 13.3 CORS 和图片

- 三张测试图片在生产来源和本机来源下均返回匹配的 `Access-Control-Allow-Origin`。
- 响应包含 `Vary: Origin`。
- 浏览器控制台无 CORS、跨域纹理或 tainted canvas 错误。
- 三张图的 `naturalWidth`、`naturalHeight` 均大于零。

### 13.4 响应式布局

- `1000px` 宽：轮播隐藏，WebGL context 数量为零，无轮播图片请求。
- `1001px` 宽：轮播显示，左边界为 `379px`，宽度为 `622px`。
- `1440x900`：图片框边界为 `left=379`、`right=1440`、`height=900`。
- 改变窗口尺寸后 Canvas 自动匹配容器。
- 页面没有新增横向滚动。
- 文字主体仍为 `left=20px`、`width=338px`，页脚位置不变。

### 13.5 视觉效果

- 画面由真实 WebGL Canvas 输出。
- 使用 Halftone CMYK `dots` 效果。
- 所有颜色和数值与第 7 节完全一致。
- 图片以 `cover` 填满，不留白、不拉伸。
- 横图和竖图均能正确裁切。
- 原始 `<img>` 在 Shader 成功时不可见。

### 13.6 轮播

- 播放顺序为 `133452 -> 133602 -> 133556 -> 133452`。
- 每 10 秒开始一次切换，误差不超过浏览器计时器正常调度范围。
- 交叉渐变为 3 秒。
- 渐变中点两层透明度约为 `0.5 / 0.5`。
- 渐变结束后只有一个图层可见。
- 连续完成至少两个完整循环，没有闪白、破图或顺序错误。

### 13.7 失败处理

- 临时将第二张 URL 改成无效地址：从第一张直接切换到第三张。
- 临时将全部 URL 改成无效地址：图片框保持白色，文字和首页脚本正常。
- 临时模拟 WebGL2 不可用：显示原始图片轮播，并输出明确错误。
- 测试后恢复全部真实 URL，最终文件不保留测试假地址。

### 13.8 性能和资源释放

- Canvas 实际像素数不超过 `2073600`。
- WebGL context 始终最多两个。
- 连续切换 20 次后 DOM 图层数量和 Canvas 数量不增长。
- 缩到 `1000px` 后两个 ShaderMount 均已 dispose，计时器停止。
- 再放大到 `1001px` 后能重新初始化一次，不重复叠加实例。

### 13.9 现有功能回归

- 年份计数持续更新。
- `and more... / less` 展开收起正常。
- 页脚五个链接保持正常。
- 其他页面无变化。
- 浏览器控制台没有未处理异常。

## 14. 完成定义

只有在第 13 节全部通过、失败数量为零，并且用户在独立 worktree 的本地预览中确认视觉效果后，才可视为 Shader 实施完成。

本阶段不包含：

- 提交 Git commit。
- 推送远端。
- 合并进 `master`。
- 发布线上网站。
