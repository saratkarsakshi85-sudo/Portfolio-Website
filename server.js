const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const videosDir = path.join(root, "animation videos");
const port = 8080;
const videoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogg"]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogg": "video/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function listVideos() {
  if (!fs.existsSync(videosDir)) return [];
  return fs
    .readdirSync(videosDir)
    .filter((name) => videoExtensions.has(path.extname(name).toLowerCase()))
    .map((name) => ({
      name: path.parse(name).name,
      url: `/animation%20videos/${encodeURIComponent(name)}`,
    }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/api/videos") {
    send(res, 200, JSON.stringify(listVideos()), "application/json; charset=utf-8");
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, types[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(port, () => {
  console.log(`Local site running at http://localhost:${port}`);
});
