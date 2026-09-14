// src/utils.js
// Utility helpers for media resolution, formatting, and buffer manipulation

import fs from 'fs'
import { Readable } from 'stream'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'

/**
 * Stream to Buffer collector
 */
export async function streamToBuffer(stream) {
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c)))
  }

  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/**
 * Resolves input (Buffer, Uint8Array, Stream, URL, File path) into a Buffer
 */
export async function resolveToBuffer(input) {
  if (input instanceof Promise) input = await input
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  if (input instanceof Readable || typeof input?.pipe === 'function' || typeof input?.getReader === 'function') {
    return streamToBuffer(input)
  }

  if (input && typeof input === 'object') {
    if (Buffer.isBuffer(input.buffer)) return input.buffer
    if (input.buffer instanceof Uint8Array) return Buffer.from(input.buffer)
    if (Buffer.isBuffer(input.data)) return input.data
    if (input.data instanceof Uint8Array) return Buffer.from(input.data)
    if (typeof input.arrayBuffer === 'function') return Buffer.from(await input.arrayBuffer())
  }

  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      const res = await fetch(input)
      if (!res.ok) throw new Error(`Failed to fetch media from URL: ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    }
    if (fs.existsSync(input)) {
      return fs.readFileSync(input)
    }
    throw new Error(`String is neither a valid URL nor an existing file path: ${input}`)
  }

  throw new Error(`Unsupported media input type: ${typeof input}`)
}

/**
 * Detects mimetype of a buffer
 */
export async function detectMimetype(buffer) {
  try {
    const detected = await fileTypeFromBuffer(buffer)
    return detected?.mime || 'application/octet-stream'
  } catch {
    return 'application/octet-stream'
  }
}

export function toBase64(x) {
  return Buffer.from(x).toString('base64')
}

export function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x
  if (x instanceof Uint8Array) return Buffer.from(x)
  if (typeof x === 'string') return Buffer.from(x, 'base64')
  throw new Error('Field must be a Buffer, Uint8Array, or base64 string.')
}

/**
 * Normalizes WhatsApp JID
 */
export function normalizeJid(jid) {
  if (!jid) return jid
  const cleaned = jid.split('/')[0].split(':')[0]
  return cleaned.includes('@') ? cleaned : `${cleaned}@s.whatsapp.net`
}

/**
 * Strips device ID from JID
 */
export function stripDeviceId(jid) {
  return jid ? jid.replace(/:\d+@/, '@') : jid
}

/**
 * Formats bytes to human-readable size
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * Formats uptime in seconds to DD HH MM SS
 */
export function formatRuntime(seconds) {
  const sec = Math.floor(seconds % 60)
  const min = Math.floor((seconds / 60) % 60)
  const hour = Math.floor((seconds / 3600) % 24)
  const day = Math.floor(seconds / 86400)

  const parts = []
  if (day > 0) parts.push(`${day}h`)
  if (hour > 0) parts.push(`${hour}j`)
  if (min > 0) parts.push(`${min}m`)
  parts.push(`${sec}d`)

  return parts.join(' ')
}

/**
 * Asynchronous sleep helper
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Simple JSON Fetcher
 */
export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
  return res.json()
}
