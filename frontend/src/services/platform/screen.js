import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { KeepAwake } from '@capacitor-community/keep-awake';

let wakeSentinel = null;

export async function lockCurrentOrientation() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { type } = await ScreenOrientation.orientation();
      await ScreenOrientation.lock({ orientation: type });
      return true;
    }
    if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock(screen.orientation.type);
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

export async function unlockOrientation() {
  try {
    if (Capacitor.isNativePlatform()) {
      await ScreenOrientation.unlock();
      return true;
    }
    if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

export async function keepScreenAwake() {
  try {
    if (Capacitor.isNativePlatform()) {
      await KeepAwake.keepAwake();
      return true;
    }
    if (typeof navigator !== 'undefined' && navigator.wakeLock) {
      wakeSentinel = await navigator.wakeLock.request('screen');
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

export async function releaseScreenAwake() {
  try {
    if (Capacitor.isNativePlatform()) {
      await KeepAwake.allowSleep();
    } else if (wakeSentinel) {
      await wakeSentinel.release();
    }
  } catch (_) {
    wakeSentinel = null;
  }
  wakeSentinel = null;
}
