function validationError(message) {
  const error = new Error(message)
  error.status = 422
  error.detail = message
  return error
}

function validateViralClip(value) {
  const clip = { ...value }
  clip.start_timestamp = Number(clip.start_timestamp)
  clip.end_timestamp = Number(clip.end_timestamp)
  clip.virality_score = Number(clip.virality_score)
  clip.title = String(clip.title || '')
  if (clip.start_timestamp < 0) throw validationError('start_timestamp must be greater than or equal to 0')
  if (clip.end_timestamp < 0) throw validationError('end_timestamp must be greater than or equal to 0')
  if (clip.end_timestamp <= clip.start_timestamp) {
    throw validationError('end_timestamp must be greater than start_timestamp')
  }
  if (clip.virality_score < 1 || clip.virality_score > 10) {
    throw validationError('virality_score must be between 1 and 10')
  }
  if (!clip.title || clip.title.length > 120) throw validationError('title must be between 1 and 120 characters')
  clip.end_timestamp = Number(clip.end_timestamp.toFixed(3))
  return clip
}

function validateGeminiAnalysisResult(value) {
  const result = { ...value }
  result.caption = String(result.caption || '').trim()
  result.overlays = (result.overlays || []).filter(text => text && String(text).trim()).map(text => String(text).trim())
  result.viral_clips = (result.viral_clips || []).map(validateViralClip)
  if (!result.overlays.length) throw validationError('overlays must contain at least one item')
  return result
}

function validateRepurposeExportRequest(value) {
  const request = {
    job_id: String(value.job_id || ''),
    background_hex: value.background_hex ?? '#000000',
    overlay_text: value.overlay_text ?? '',
    caption: value.caption ?? '',
    overlay_y_position_normalized: value.overlay_y_position_normalized ?? 0.12,
  }
  if (!request.job_id) throw validationError('job_id is required')
  if (!/^#[0-9a-fA-F]{6}$/.test(request.background_hex)) {
    throw validationError('background_hex must be a CSS hex color')
  }
  request.overlay_text = String(request.overlay_text)
  request.caption = String(request.caption)
  request.overlay_y_position_normalized = Number(request.overlay_y_position_normalized)
  if (request.overlay_text.length > 200) throw validationError('overlay_text must be at most 200 characters')
  if (request.caption.length > 2000) throw validationError('caption must be at most 2000 characters')
  if (request.overlay_y_position_normalized < 0 || request.overlay_y_position_normalized > 1) {
    throw validationError('overlay_y_position_normalized must be between 0 and 1')
  }
  return request
}

module.exports = {
  validationError,
  validateViralClip,
  validateGeminiAnalysisResult,
  validateRepurposeExportRequest,
}
