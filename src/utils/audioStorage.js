// src/utils/audioStorage.js

const DB_NAME = 'VideoSoSanhDB';
const DB_VERSION = 3; // Bumped version to support imageStore and videoStore
const AUDIO_STORE = 'audioStore';
const IMAGE_STORE = 'imageStore';
const VIDEO_STORE = 'videoStore';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE);
      }
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        db.createObjectStore(VIDEO_STORE);
      }
    };
    request.onsuccess = (e) => {
      resolve(e.target.result);
    };
    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

/**
 * Saves an audio blob and its filename into IndexedDB
 * @param {Blob} blob 
 * @param {string} fileName 
 */
export async function saveAudioToStorage(blob, fileName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUDIO_STORE, 'readwrite');
      const store = transaction.objectStore(AUDIO_STORE);
      
      const record = {
        blob,
        fileName,
        timestamp: Date.now()
      };
      
      // Save as the current active audio
      store.put(record, 'currentAudio');
      // Save keyed by unique filename for future recovery
      if (fileName) {
        store.put(record, fileName);
      }
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to save audio to IndexedDB:', err);
  }
}

/**
 * Retrieves the saved audio blob and filename from IndexedDB
 * @param {string} key - Optional key, defaults to 'currentAudio'
 * @returns {Promise<{blob: Blob, fileName: string} | null>}
 */
export async function getAudioFromStorage(key = 'currentAudio') {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUDIO_STORE, 'readonly');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.get(key);
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to get audio from IndexedDB:', err);
    return null;
  }
}

/**
 * Clears the saved audio from IndexedDB
 */
export async function clearAudioFromStorage() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(AUDIO_STORE, 'readwrite');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.delete('currentAudio');
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to clear audio from IndexedDB:', err);
  }
}

/**
 * Saves a binary image Blob into IndexedDB
 * @param {string} key - The original blob url
 * @param {Blob} blob 
 */
export async function saveImageToStorage(key, blob) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE);
      const request = store.put(blob, key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to save image to IndexedDB:', err);
  }
}

/**
 * Retrieves a saved image Blob from IndexedDB
 * @param {string} key - The original blob url
 * @returns {Promise<Blob | null>}
 */
export async function getImageFromStorage(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, 'readonly');
      const store = transaction.objectStore(IMAGE_STORE);
      const request = store.get(key);
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to get image from IndexedDB:', err);
    return null;
  }
}

/**
 * Clears all saved images from IndexedDB
 */
export async function clearImagesFromStorage() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to clear images from IndexedDB:', err);
  }
}

/**
 * Deletes a saved image from IndexedDB
 * @param {string} key - The blob url to delete
 */
export async function deleteImageFromStorage(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, 'readwrite');
      const store = transaction.objectStore(IMAGE_STORE);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to delete image from IndexedDB:', err);
  }
}

/**
 * Saves a binary video Blob into IndexedDB
 * @param {string} key - The unique post ID or video name
 * @param {Blob} blob 
 */
export async function saveVideoToStorage(key, blob) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VIDEO_STORE, 'readwrite');
      const store = transaction.objectStore(VIDEO_STORE);
      const request = store.put(blob, key);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to save video to IndexedDB:', err);
  }
}

/**
 * Retrieves a saved video Blob from IndexedDB
 * @param {string} key - The unique post ID or video name
 * @returns {Promise<Blob | null>}
 */
export async function getVideoFromStorage(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VIDEO_STORE, 'readonly');
      const store = transaction.objectStore(VIDEO_STORE);
      const request = store.get(key);
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to get video from IndexedDB:', err);
    return null;
  }
}
