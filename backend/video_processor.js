const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const BASE_DIR = __dirname
const CLIPS_DIR = path.join(BASE_DIR, 'clips')
fs.mkdirSync(CLIPS_DIR, { recursive: true })

function generateThumbnail(videoPath, clipId) {
  const thumbPath = path.join(CLIPS_DIR, `${clipId}_thumb.jpg`)
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-ss', '00:00:01',
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      thumbPath,
    ], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || 'Thumbnail generation failed'))
        return
      }
      resolve(thumbPath)
    })
  })
}

module.exports = { generateThumbnail }
