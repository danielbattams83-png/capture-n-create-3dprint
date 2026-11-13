# Capture & Create - 3D Print Studio

A Next.js App Router app for generating 3D models from one to four uploaded photos using Meshy's Image-to-3D APIs. The interface includes multi-angle image upload and preview, task progress, interactive GLB inspection, GLB/STL downloads, and editable X, Y, and Z dimensions in millimeters.

## Run locally

```bash
npm install
npm run dev
```

Create `.env.local` in the project root and add your Meshy API key:

```env
MESHY_API_KEY=your_meshy_api_key
```

You can copy `.env.local.example` as a starting point. The key is only read by server routes and is never sent to the browser. Restart the dev server after changing `.env.local`.

Open [http://localhost:3000](http://localhost:3000).

## API routes

- `POST /api/generate-3d` accepts one to four `images` files in multipart form data and returns a `task_id`, signed `task_token`, and `task_type`. One image uses Image-to-3D; multiple images use Multi-Image-to-3D.
- `POST /api/poll-task` accepts `{ "task_id": "...", "task_type": "...", "task_token": "..." }` and returns task status/progress. Once succeeded, the response includes available `model_urls.glb` and `model_urls.stl` download links.
- `POST /api/model-preview` accepts the same task credentials and streams the completed GLB through the server for the in-browser viewer.

Uploads are limited to four JPG, PNG, or WebP images, each up to 20 MB. For multi-image generation, photos should show the same object from different angles; the first image is treated as the front view. Meshy validates image dimensions and may reject unsupported images. Polling tokens are signed server-side to prevent arbitrary task lookups, and cross-origin browser requests are rejected. The dimensions panel is currently a UI setting; it does not resize the generated model.

The in-browser viewer uses React Three Fiber and Drei for orbit, zoom, and pan controls. The GLB is streamed through the server to avoid browser cross-origin restrictions when loading Meshy assets. Its grid represents a 220 × 220 mm printer bed; the GLB preview and binary STL export use the configured X, Y, and Z dimensions. STL-only output can still be downloaded but cannot be previewed or rescaled in the browser.
