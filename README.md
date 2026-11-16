# Capture & Create - 3D Print Studio

A Next.js App Router app for generating 3D models from one to four uploaded photos. The interface includes client-side background removal and subject cropping with approval, multi-angle image preview, task progress, interactive GLB inspection, AI texture generation, GLB/STL downloads, editable dimensions, a free model browser, a calibration preview, and a local 3D creations carousel.

## Run locally

```bash
npm install
npm run dev
```

Create `.env.local` in the project root and configure the server-only image generation credential using the setting shown in `.env.local.example`.

The credential is only read by server routes and is never sent to the browser. Restart the dev server after changing `.env.local`.

Open [http://localhost:3000](http://localhost:3000).

## API routes

- `POST /api/generate-3d` accepts one to four `images` files in multipart form data and returns a `task_id`, signed `task_token`, and `task_type`. One image uses Image-to-3D; multiple images use Multi-Image-to-3D.
- `POST /api/poll-task` accepts `{ "task_id": "...", "task_type": "...", "task_token": "..." }` and returns task status/progress. Once succeeded, the response includes available `model_urls.glb` and `model_urls.stl` download links.
- `POST /api/model-preview` accepts the same task credentials and streams the completed GLB through the server for the in-browser viewer.
- `POST /api/meshy-texture` accepts an active GLB, texture prompt, and style preset, then starts a Meshy Retexture task without exposing the API key.
- `POST /api/meshy-texture/status` securely reports Retexture task status and percentage.
- `POST /api/meshy-texture/model` streams the completed textured GLB through the server.

Uploads are limited to four JPG, PNG, or WebP images, each up to 20 MB. Each captured or uploaded image is processed locally with `@imgly/background-removal`, cropped to its alpha-channel subject bounds with 10% padding, and shown for approval before its PNG is added to the generation set. For multi-image generation, photos should show the same object from different angles; the first image is treated as the front view. The calibration preview uses a 250 × 250 mm reference bed; its width and height stay synchronized with the print dimensions and preserve their proportions by default, with an optional unlock for independent scaling. Polling tokens are signed server-side to prevent arbitrary task lookups, and cross-origin browser requests are rejected. The dimensions panel is a UI setting; it does not resize the generated model sent for generation.

The in-browser viewer uses React Three Fiber and Drei for orbit, zoom, and pan controls. The GLB is streamed through the server to avoid browser cross-origin restrictions when loading model assets. Its grid represents a 250 × 250 mm printer bed; the GLB preview and binary STL export use the configured X, Y, and Z dimensions. STL-only output can still be downloaded but cannot be previewed or rescaled in the browser.

The texture panel sends the active GLB and an enhanced style prompt to Meshy's Retexture API through server-only routes. It polls task progress, downloads the finished textured GLB immediately, and replaces only the model inside the existing Three.js canvas so the current camera angle is retained. Texture generation uses Meshy credits and supports GLB files up to 100 MB.

Completed GLB models are stored in IndexedDB on the current device with their dimensions and a seven-day expiration timestamp. Expired records are purged when the creations library loads. The centered carousel model uses a lightweight animated React Three Fiber viewport; side models use paused, on-demand canvases.

The free asset browser reads the public Khronos glTF Sample Assets manifest and presents a curated set of downloadable CC0 and CC BY models. Models can be searched or filtered by Props, Furniture, Nature, and Characters, opened directly in the existing editor, resized, downloaded, and saved to the local Creations library.
