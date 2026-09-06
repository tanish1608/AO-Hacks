import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
/**
 * Cloud Run's filesystem does not survive an instance, so the database is
 * restored from Cloud Storage at boot and snapshotted back after writes.
 * Writes are debounced: a run step commits several times in a row, and each
 * snapshot is a full upload.
 *
 * This pairs with max-instances=1. Two instances would each hold their own
 * copy and the last snapshot would win, silently discarding the other's work.
 */
const BUCKET = process.env.DB_BUCKET;
const OBJECT = process.env.DB_OBJECT ?? 'foundry.sqlite';
const DEBOUNCE_MS = Number(process.env.DB_SNAPSHOT_DEBOUNCE_MS ?? 4000);
let storage = null;
let timer = null;
let inFlight = Promise.resolve();
let currentFile = null;
async function bucket() {
  if (!BUCKET) return null;
  if (!storage) {
    const { Storage } = await import('@google-cloud/storage');
    storage = new Storage();
  }
  return storage.bucket(BUCKET);
}
export async function restore(file) {
  currentFile = file;
  const target = await bucket();
  if (!target) return false;
  try {
    const blob = target.file(OBJECT);
    const [exists] = await blob.exists();
    if (!exists) {
      console.log('no snapshot in storage; starting a new database');
      return false;
    }
    const [data] = await blob.download();
    await writeFile(file, data);
    console.log(`restored ${data.length} bytes from gs://${BUCKET}/${OBJECT}`);
    return true;
  } catch (error) {
    // Starting empty would silently discard existing data, so fail loudly.
    console.error('could not restore the database snapshot', error);
    throw error;
  }
}
async function upload(file) {
  const target = await bucket();
  if (!target) return;
  try {
    const data = await readFile(file);
    await target.file(OBJECT).save(data, {
      contentType: 'application/x-sqlite3',
      resumable: false,
    });
  } catch (error) {
    console.error('snapshot upload failed', error);
  }
}
export function scheduleSnapshot() {
  if (!BUCKET || !currentFile) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    inFlight = inFlight.then(() => upload(currentFile));
  }, DEBOUNCE_MS);
}
export async function shutdown(db, file) {
  clearTimeout(timer);
  try {
    db.checkpoint();
  } catch (error) {
    console.error('checkpoint failed', error);
  }
  await inFlight;
  if (BUCKET && existsSync(file)) await upload(file);
  try {
    db.close();
  } catch {}
}
