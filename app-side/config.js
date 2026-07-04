// Change this to your HTTPS endpoint.
// The Side Service runs on the phone side, so this HTTP POST is done by the
// companion phone environment, not directly by the watch.
export const SERVER_UPLOAD_URL = 'https://ideas.lefred.be/api/voice-ideas'

// Debug endpoint used to confirm that the phone Side Service is running and
// receiving files. Add this route on your server while debugging.
export const SERVER_DEBUG_URL = 'https://ideas.lefred.be/api/voice-ideas/debug'

export const REQUEST_TIMEOUT_MS = 30000
