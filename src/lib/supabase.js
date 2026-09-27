import { createClient } from '@supabase/supabase-js'
import { withRetry } from './retry'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.warn('Supabase env vars are not set. Copy .env.example to .env and fill in your project values.')
}

// Fall back to a placeholder URL when unconfigured so createClient doesn't throw at import time;
// isConfigured gates the app before any real request is made.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder')

export const PHOTO_BUCKET = 'mingay-photos'

export async function uploadPhoto(file, prefix) {
  const ext = file.name.split('.').pop()
  const path = `${prefix}-${Date.now()}.${ext}`
  // 写真は本体データより重いので、回線が不安定なときほど失敗しやすい。読み書きと同じく再試行する。
  const { error } = await withRetry(() => supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type,
  }))
  if (error) {
    console.error(error)
    return null
  }
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
