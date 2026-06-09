import initSqlJs, { type Database } from 'sql.js';
import { join } from 'node:path';
import type { SearchHit } from '../../shared/domain';

export class SqliteSearchCache {
  private db?: Database;

  async initialize(): Promise<void> {
    if (this.db) return;
    const SQL = await initSqlJs({
      locateFile: (file: string) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
    });
    this.db = new SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS recent_projects (id TEXT PRIMARY KEY, opened_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS search_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_role TEXT NOT NULL,
        pointer TEXT NOT NULL,
        label TEXT NOT NULL,
        preview TEXT NOT NULL
      );
    `);
  }

  async replaceIndex(entries: SearchHit[]): Promise<void> {
    await this.initialize();
    const db = this.requireDb();
    db.run('DELETE FROM search_index');
    const statement = db.prepare('INSERT INTO search_index (artifact_role, pointer, label, preview) VALUES (?, ?, ?, ?)');
    try {
      for (const entry of entries) {
        statement.run([entry.artifactRole, entry.pointer, entry.label, entry.preview]);
      }
    } finally {
      statement.free();
    }
  }

  async search(query: string): Promise<SearchHit[]> {
    await this.initialize();
    const db = this.requireDb();
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const statement = db.prepare(`
      SELECT artifact_role, pointer, label, preview
      FROM search_index
      WHERE lower(preview) LIKE ?
      ORDER BY id
      LIMIT 50
    `);
    const hits: SearchHit[] = [];
    try {
      statement.bind([`%${normalized}%`]);
      while (statement.step()) {
        const row = statement.getAsObject() as Record<string, string>;
        hits.push({
          artifactRole: row.artifact_role as SearchHit['artifactRole'],
          pointer: row.pointer,
          label: row.label,
          preview: row.preview
        });
      }
    } finally {
      statement.free();
    }
    return hits;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('SQLite cache was not initialized.');
    return this.db;
  }
}
