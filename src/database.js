// src/database.js
// Local SQLite Database helper using better-sqlite3 for contacts & group settings

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import config from '../config.js'

let db = null

export function initDatabase() {
  if (db) return db

  const dbDir = path.dirname(config.databasePath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  db = new Database(config.databasePath)
  db.pragma('journal_mode = WAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      push_name TEXT,
      phone_number TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS groups (
      jid TEXT PRIMARY KEY,
      subject TEXT,
      antilink INTEGER DEFAULT 0,
      welcome INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  return db
}

// Contacts CRUD
export function upsertContact(jid, pushName, phoneNumber = null) {
  if (!jid) return
  const database = initDatabase()
  const now = Math.floor(Date.now() / 1000)

  const stmt = database.prepare(`
    INSERT INTO contacts (jid, push_name, phone_number, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      push_name = COALESCE(excluded.push_name, contacts.push_name),
      phone_number = COALESCE(excluded.phone_number, contacts.phone_number),
      updated_at = excluded.updated_at
  `)

  return stmt.run(jid, pushName || null, phoneNumber || null, now)
}

export function getContact(jid) {
  if (!jid) return null
  const database = initDatabase()
  const stmt = database.prepare('SELECT * FROM contacts WHERE jid = ?')
  return stmt.get(jid)
}

// Groups CRUD
export function upsertGroup(jid, subject, options = {}) {
  if (!jid) return
  const database = initDatabase()
  const now = Math.floor(Date.now() / 1000)

  const stmt = database.prepare(`
    INSERT INTO groups (jid, subject, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      subject = COALESCE(excluded.subject, groups.subject),
      updated_at = excluded.updated_at
  `)

  return stmt.run(jid, subject || null, now)
}

export function getGroup(jid) {
  if (!jid) return null
  const database = initDatabase()
  const stmt = database.prepare('SELECT * FROM groups WHERE jid = ?')
  return stmt.get(jid)
}

export function setGroupSetting(jid, settingKey, value) {
  if (!jid || !settingKey) return
  const database = initDatabase()
  const allowedKeys = ['antilink', 'welcome', 'muted']
  if (!allowedKeys.includes(settingKey)) return

  const stmt = database.prepare(`
    UPDATE groups SET ${settingKey} = ?, updated_at = ? WHERE jid = ?
  `)
  return stmt.run(value ? 1 : 0, Math.floor(Date.now() / 1000), jid)
}

export default {
  initDatabase,
  upsertContact,
  getContact,
  upsertGroup,
  getGroup,
  setGroupSetting
}
