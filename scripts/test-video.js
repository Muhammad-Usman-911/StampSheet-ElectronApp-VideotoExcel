// Usage: node scripts/test-video.js path/to/video.mp4 [cameraName]
const { analyseVideo, closeWorker } = require('../src/videoMeta');
analyseVideo(process.argv[2], { camera: process.argv[3] || 'Camera 1' })
  .then((r) => console.log(r)).catch(console.error).finally(closeWorker);
